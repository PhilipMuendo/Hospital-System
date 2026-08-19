import net from 'node:net'
import { prisma } from './prisma.js'
import { writeAudit } from './audit.js'
import { Hl7Message, MllpFramer, buildAck, parseOru, wrapMllp } from './hl7.js'

/**
 * TCP listener that accepts HL7 v2 over MLLP from biomedical devices.
 *
 * This is the standard path for patient monitors and bench analysers: the
 * device (or its vendor gateway) is configured with our IP and port and pushes
 * ORU^R01 results as they are taken.
 *
 * Deliberate design decisions:
 *  - every message is persisted raw BEFORE parsing, so a message we cannot
 *    understand is still recoverable and diagnosable;
 *  - an ACK is always returned, including on failure, because an un-ACKed
 *    device retries and then alarms;
 *  - readings land in DeviceReading unaccepted. They do not become chart
 *    vitals until a nurse confirms them — an unattended monitor generates
 *    artefact constantly and a detached lead must not enter the record as
 *    a real observation.
 */

const DEFAULT_PORT = 2575 // the IANA-registered port for HL7 over MLLP

export interface MllpServerOptions {
  port?: number
  host?: string
  /**
   * Only these source IPs may connect. Empty means allow any, which is only
   * acceptable on an isolated biomedical VLAN.
   */
  allowedIps?: string[]
}

export function createMllpServer(options: MllpServerOptions = {}) {
  const port = options.port ?? Number(process.env.HL7_MLLP_PORT) ?? DEFAULT_PORT
  const host = options.host ?? process.env.HL7_MLLP_HOST ?? '0.0.0.0'
  const allowed =
    options.allowedIps ??
    (process.env.HL7_ALLOWED_IPS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

  const server = net.createServer((socket) => {
    const peer = socket.remoteAddress?.replace(/^::ffff:/, '') ?? 'unknown'

    if (allowed.length > 0 && !allowed.includes(peer)) {
      void writeAudit({
        actorLabel: `device@${peer}`,
        action: 'DENIED',
        entity: 'DeviceMessage',
        path: 'mllp://hl7',
        ip: peer,
        meta: { reason: 'source IP not in HL7_ALLOWED_IPS' },
      })
      socket.destroy()
      return
    }

    const framer = new MllpFramer()
    socket.setTimeout(120_000)
    socket.on('timeout', () => socket.end())
    socket.on('error', (err) => console.error(`[mllp] socket error from ${peer}:`, err.message))

    socket.on('data', (chunk) => {
      let frames: string[]
      try {
        frames = framer.push(chunk)
      } catch (err) {
        console.error('[mllp] framing error', err)
        return
      }

      for (const raw of frames) {
        void handleMessage(raw, peer)
          .then((ack) => socket.write(wrapMllp(ack)))
          .catch((err) => {
            console.error('[mllp] handler failed', err)
            socket.write(wrapMllp(buildAck(null, 'AE', 'Internal error')))
          })
      }
    })
  })

  server.on('error', (err) => console.error('[mllp] server error', err))

  return {
    server,
    listen: () =>
      new Promise<void>((resolve) => {
        server.listen(port, host, () => {
          console.log(`HL7 MLLP listener on ${host}:${port}${allowed.length ? ` (allowlist: ${allowed.join(', ')})` : ' (open — restrict via HL7_ALLOWED_IPS)'}`)
          resolve()
        })
      }),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    port,
  }
}

/** Persist, parse, stage. Returns the ACK payload to send back. */
export async function handleMessage(raw: string, peer: string): Promise<string> {
  let msg: Hl7Message | null = null

  try {
    msg = new Hl7Message(raw)
  } catch (err) {
    await prisma.deviceMessage.create({
      data: {
        transport: 'HL7_MLLP',
        raw,
        parsed: false,
        parseError: err instanceof Error ? err.message : 'unparseable',
        sourceIp: peer,
      },
    })
    return buildAck(null, 'AR', 'Message could not be parsed')
  }

  // Match the sender to the asset register via MSH-3.
  const device = msg.sendingApplication
    ? await prisma.device.findUnique({ where: { hl7SendingApplication: msg.sendingApplication } })
    : null

  const record = await prisma.deviceMessage.create({
    data: {
      deviceId: device?.id ?? null,
      transport: 'HL7_MLLP',
      raw,
      messageType: msg.messageType,
      controlId: msg.controlId,
      sourceIp: peer,
      parsed: false,
    },
  })

  if (!device) {
    // Stored, but refused: an unregistered device must not write to charts.
    await writeAudit({
      actorLabel: `device@${peer}`,
      action: 'DENIED',
      entity: 'DeviceMessage',
      entityId: record.id,
      path: 'mllp://hl7',
      ip: peer,
      meta: { reason: 'unregistered sending application', sendingApplication: msg.sendingApplication },
    })
    return buildAck(msg, 'AR', `Unknown sending application ${msg.sendingApplication}`)
  }

  await prisma.device.update({
    where: { id: device.id },
    data: { lastSeenAt: new Date(), status: device.status === 'OFFLINE' ? 'ONLINE' : device.status },
  })

  if (!msg.messageType.startsWith('ORU')) {
    await prisma.deviceMessage.update({
      where: { id: record.id },
      data: { parsed: true, parseError: `Unhandled message type ${msg.messageType}` },
    })
    return buildAck(msg, 'AA')
  }

  const oru = parseOru(msg)

  // PID-3 carries whatever identifier the device was configured with. Our IP
  // number is the only one a ward device is ever given.
  const patient = oru.patientIdentifier
    ? await prisma.patient.findUnique({ where: { ipNumber: oru.patientIdentifier } })
    : null

  if (oru.observations.length > 0) {
    await prisma.deviceReading.createMany({
      data: oru.observations.map((o) => ({
        deviceId: device.id,
        patientId: patient?.id ?? null,
        code: o.code,
        label: o.label,
        value: o.value,
        unit: o.unit,
        abnormalFlag: o.abnormalFlag,
        measuredAt: o.measuredAt ?? new Date(),
        accepted: false,
      })),
    })
  }

  await prisma.deviceMessage.update({
    where: { id: record.id },
    data: { parsed: true, patientId: patient?.id ?? null },
  })

  await writeAudit({
    actorLabel: `device:${device.assetTag}`,
    action: 'CREATE',
    entity: 'DeviceReading',
    entityId: record.id,
    patientId: patient?.id ?? null,
    path: 'mllp://hl7',
    ip: peer,
    meta: {
      messageType: oru.messageType,
      observations: oru.observations.length,
      patientIdentifier: oru.patientIdentifier,
      matchedPatient: !!patient,
    },
  })

  // An unmatched patient is accepted (the data is safe in DeviceReading) but
  // flagged, because it means a bed was admitted or moved without the device
  // being re-associated.
  return patient || !oru.patientIdentifier
    ? buildAck(msg, 'AA')
    : buildAck(msg, 'AE', `Unknown patient identifier ${oru.patientIdentifier}`)
}
