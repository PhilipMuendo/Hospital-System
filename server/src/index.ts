import 'dotenv/config'
import { createApp } from './app.js'
import { createMllpServer } from './lib/mllp-server.js'
import { startHeartbeat } from './lib/queue-events.js'
import { assertCallbackSecurity } from './middleware/security.js'

// Fail fast rather than run a production process that would accept forged
// payment confirmations.
assertCallbackSecurity()

const port = Number(process.env.PORT) || 4000
const app = createApp()

app.listen(port, () => {
  console.log(`Uzima HMS API listening on http://localhost:${port}`)
})

// Keeps idle SSE connections to the waiting-room board alive through proxies.
startHeartbeat()

// Biomedical device ingest. Opt-in: a TCP listener should only be bound where
// the biomedical VLAN actually reaches, so it stays off unless asked for.
if (process.env.HL7_MLLP_ENABLED === 'true') {
  const mllp = createMllpServer()
  void mllp.listen()
}
