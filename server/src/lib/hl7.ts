/**
 * Minimal HL7 v2.x reader for the message types biomedical devices actually
 * emit: ORU^R01 (observation result) and ADT feeds.
 *
 * This is not a general-purpose HL7 engine. It handles the subset that patient
 * monitors, pulse oximeters and bench analysers send, which in practice is
 * MSH + PID + OBR + repeated OBX. Anything richer should go to a real
 * interface engine (Mirth, Rhapsody) rather than grow here.
 *
 * Encoding notes that matter in the field:
 *  - segments are separated by \r (0x0D), NOT \n. Devices that use \n exist,
 *    so both are tolerated on read.
 *  - MSH-1 is the field separator itself and MSH-2 the encoding characters,
 *    so MSH field numbering is offset by one relative to every other segment.
 */

export interface Hl7Field {
  raw: string
  components: string[]
}

export class Hl7Message {
  readonly segments: string[][]
  readonly fieldSep: string
  readonly componentSep: string
  readonly repeatSep: string
  readonly escapeChar: string
  readonly subComponentSep: string

  constructor(raw: string) {
    const text = raw.replace(/\n/g, '\r').replace(/\r+/g, '\r').trim()
    if (!text.startsWith('MSH')) {
      throw new Error('Not an HL7 message: does not start with MSH')
    }

    this.fieldSep = text[3] ?? '|'
    const encoding = text.slice(4, 8)
    this.componentSep = encoding[0] ?? '^'
    this.repeatSep = encoding[1] ?? '~'
    this.escapeChar = encoding[2] ?? '\\'
    this.subComponentSep = encoding[3] ?? '&'

    this.segments = text
      .split('\r')
      .filter((s) => s.trim().length > 0)
      .map((s) => s.split(this.fieldSep))
  }

  segment(name: string): string[] | undefined {
    return this.segments.find((s) => s[0] === name)
  }

  allSegments(name: string): string[][] {
    return this.segments.filter((s) => s[0] === name)
  }

  /**
   * Field by 1-based HL7 index. MSH is special-cased: MSH-1 is the separator,
   * so MSH-9 lands at array position 8 rather than 9.
   */
  static field(segment: string[] | undefined, index: number): string {
    if (!segment) return ''
    const pos = segment[0] === 'MSH' ? index - 1 : index
    return segment[pos] ?? ''
  }

  component(value: string, index: number): string {
    return value.split(this.componentSep)[index - 1] ?? ''
  }

  get messageType(): string {
    const msh = this.segment('MSH')
    const raw = Hl7Message.field(msh, 9)
    // MSH-9 is "ORU^R01^ORU_R01"; the first two components are what matters.
    const parts = raw.split(this.componentSep)
    return parts.slice(0, 2).filter(Boolean).join('^')
  }

  get controlId(): string {
    return Hl7Message.field(this.segment('MSH'), 10)
  }

  get sendingApplication(): string {
    return this.component(Hl7Message.field(this.segment('MSH'), 3), 1)
  }

  get sendingFacility(): string {
    return this.component(Hl7Message.field(this.segment('MSH'), 4), 1)
  }
}

/** HL7 timestamp (YYYYMMDDHHMMSS[.S+][+/-ZZZZ]) to a real instant. */
export function parseHl7Date(value: string): Date | null {
  if (!value) return null
  const m = /^(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(value.trim())
  if (!m) return null

  const [, y, mo = '01', d = '01', h = '00', mi = '00', s = '00'] = m
  const tz = /([+-]\d{4})$/.exec(value.trim())?.[1]
  // Devices on a hospital LAN are almost always set to local time and often
  // omit the offset entirely, so Nairobi is the right assumption here.
  const offset = tz ? `${tz.slice(0, 3)}:${tz.slice(3)}` : '+03:00'

  const parsed = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${offset}`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export interface ParsedObservation {
  code: string
  label: string
  value: string
  unit: string
  abnormalFlag: string | null
  measuredAt: Date | null
}

export interface ParsedOru {
  messageType: string
  controlId: string
  sendingApplication: string
  /** PID-3, the patient identifier the device was given — our IP number. */
  patientIdentifier: string
  patientName: string
  observations: ParsedObservation[]
}

/**
 * Pull the clinically useful parts out of an ORU^R01.
 *
 * OBX-11 carries the observation result status; 'D' means the device is
 * retracting a previously sent result, and 'X' means it could not produce one.
 * Neither should become a vital sign, so both are dropped.
 */
export function parseOru(msg: Hl7Message): ParsedOru {
  const pid = msg.segment('PID')
  const obr = msg.segment('OBR')

  const patientIdentifier = msg.component(Hl7Message.field(pid, 3), 1)
  const nameField = Hl7Message.field(pid, 5)
  const family = msg.component(nameField, 1)
  const given = msg.component(nameField, 2)

  const obrTime = parseHl7Date(Hl7Message.field(obr, 7))

  const observations: ParsedObservation[] = []

  for (const obx of msg.allSegments('OBX')) {
    const status = Hl7Message.field(obx, 11)
    if (status === 'D' || status === 'X') continue

    const identifier = Hl7Message.field(obx, 3)
    const code = msg.component(identifier, 1)
    const label = msg.component(identifier, 2) || code
    const value = Hl7Message.field(obx, 5)
    if (!code || value === '') continue

    observations.push({
      code,
      label,
      value,
      unit: msg.component(Hl7Message.field(obx, 6), 1),
      abnormalFlag: Hl7Message.field(obx, 8) || null,
      measuredAt: parseHl7Date(Hl7Message.field(obx, 14)) ?? obrTime,
    })
  }

  return {
    messageType: msg.messageType,
    controlId: msg.controlId,
    sendingApplication: msg.sendingApplication,
    patientIdentifier,
    patientName: [given, family].filter(Boolean).join(' '),
    observations,
  }
}

/**
 * Build the ACK the sender is waiting on. A device that does not get one will
 * usually retry, then alarm, then stop sending — so this must always be
 * produced, including for messages we failed to parse.
 */
export function buildAck(
  original: Hl7Message | null,
  code: 'AA' | 'AE' | 'AR',
  text?: string,
): string {
  const controlId = original?.controlId ?? 'UNKNOWN'
  const sendingApp = original?.sendingApplication ?? 'DEVICE'
  const stamp = new Date()
    .toISOString()
    .replace(/[-:T]/g, '')
    .slice(0, 14)

  const segments = [
    `MSH|^~\\&|UZIMA_HMS|UZIMA|${sendingApp}|UZIMA|${stamp}||ACK|${stamp}|P|2.5`,
    `MSA|${code}|${controlId}${text ? `|${text.replace(/[|^~\\&\r\n]/g, ' ')}` : ''}`,
  ]

  return segments.join('\r') + '\r'
}

/* --------------------------------------------------------------------------
   MLLP framing

   HL7 over TCP is wrapped in Minimal Lower Layer Protocol: <VT> payload <FS><CR>.
   Without the wrapper the receiver cannot tell where one message ends and the
   next begins, since HL7 itself has no length prefix.
   -------------------------------------------------------------------------- */

export const MLLP_START = 0x0b // <VT>
export const MLLP_END = 0x1c // <FS>
export const MLLP_CR = 0x0d

export function wrapMllp(payload: string): Buffer {
  return Buffer.concat([
    Buffer.from([MLLP_START]),
    Buffer.from(payload, 'utf8'),
    Buffer.from([MLLP_END, MLLP_CR]),
  ])
}

/**
 * Incremental MLLP frame reader. TCP gives no message boundaries — a single
 * read can contain half a message or three of them — so bytes accumulate here
 * until complete frames can be handed off.
 */
export class MllpFramer {
  private buffer: Buffer = Buffer.alloc(0)

  /** Guards against a device that opens a socket and streams junk forever. */
  constructor(private readonly maxFrameBytes = 1_000_000) {}

  push(chunk: Buffer): string[] {
    this.buffer = Buffer.concat([this.buffer, chunk])
    const frames: string[] = []

    for (;;) {
      const start = this.buffer.indexOf(MLLP_START)
      if (start === -1) {
        // Nothing framed yet. Don't hoard unbounded garbage.
        if (this.buffer.length > this.maxFrameBytes) this.buffer = Buffer.alloc(0)
        break
      }

      const end = this.buffer.indexOf(MLLP_END, start + 1)
      if (end === -1) {
        if (this.buffer.length - start > this.maxFrameBytes) {
          this.buffer = Buffer.alloc(0)
        } else if (start > 0) {
          // Discard leading noise before the first start byte.
          this.buffer = this.buffer.subarray(start)
        }
        break
      }

      frames.push(this.buffer.subarray(start + 1, end).toString('utf8'))
      // Step past <FS> and the trailing <CR> if present.
      const next = end + (this.buffer[end + 1] === MLLP_CR ? 2 : 1)
      this.buffer = this.buffer.subarray(next)
    }

    return frames
  }
}
