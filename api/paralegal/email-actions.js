// Approval-gated email actions: prepare a review card, then send on approval.
// Drafts are composed by the controller; sends use the exact stored email.
import { createHash } from 'node:crypto'
import { requireParalegalUser } from '../../lib/paralegal/auth.js'
import { createNeedToSetController } from '../../src/paralegal/need-to-set-controller.mjs'
import { createSupabaseReviews } from '../../lib/paralegal/reviews.js'
import { composeScheduleEmail } from '../../lib/paralegal/emailCompose.js'
import { createMicrosoftTokenStore } from '../../lib/paralegal/microsoft/tokenStore.js'
import { sendMail } from '../../lib/paralegal/microsoft/graph.js'

function revisionFor(row) {
  return createHash('sha256').update(JSON.stringify([row.currentStep, row.latestUpdate, row.waitingOn, row.nextAction])).digest('hex').slice(0, 32)
}

function mapSnapshotToTasks(snapshot = []) {
  return snapshot.map((row) => ({
    id: String(row.id || ''),
    matterId: String(row.matterId || ''),
    revision: revisionFor(row),
    matterName: String(row.matterName || ''),
    status: String(row.stage || ''),
    step: String(row.currentStep || ''),
    waitingOn: String(row.waitingOn || ''),
    nextAction: String(row.nextAction || ''),
    updatedAt: String(row.latestUpdate || '')
  }))
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed.' })
  try {
    const user = await requireParalegalUser(req)
    const body = req.body || {}
    if (body.action === 'send_email') return send(req, res, user, body)
    return prepare(req, res, user, body)
  } catch (error) {
    return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Email action failed.' })
  }
}

async function prepare(req, res, user, body) {
  const tasks = mapSnapshotToTasks(body.snapshot || [])
  const contacts = body.contacts || {}
  const controller = createNeedToSetController({
    getSession: async () => ({ ownerId: user.id, ready: true }),
    readTasks: async () => tasks,
    composeEmail: async (_account, task, command) => composeScheduleEmail(task, { action: command.action, instruction: command.instruction, contacts }),
    reviews: createSupabaseReviews()
  })
  const review = await controller.prepare({ taskId: body.taskId, action: body.emailAction, instruction: body.instruction })
  return res.status(200).json({ ok: true, review })
}

async function send(req, res, user, body) {
  const reviewId = String(body.reviewId || '')
  if (!reviewId) return res.status(400).json({ ok: false, error: 'A reviewId is required to send.' })
  const reviews = createSupabaseReviews()
  const review = await reviews.load(user.id, reviewId)
  if (!review) return res.status(404).json({ ok: false, error: 'Review not found.' })
  if (Date.parse(review.expiresAt) <= Date.now()) return res.status(409).json({ ok: false, error: 'Review expired; prepare a fresh draft.' })
  const token = await createMicrosoftTokenStore().load(user.id)
  if (!token) return res.status(409).json({ ok: false, error: 'Connect Outlook before sending.' })
  const { status } = await sendMail({
    accessToken: token.accessToken,
    message: {
      subject: review.email.subject,
      body: { contentType: 'Text', content: review.email.body },
      toRecipients: review.email.to.map((address) => ({ emailAddress: { address } }))
    }
  })
  return res.status(200).json({ ok: true, status, note: 'Accepted for sending; delivery is confirmed by the provider separately.' })
}
