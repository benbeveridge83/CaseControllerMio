export default function handler(req, res) {
  res.status(200).json({
    hasClientId: Boolean(process.env.CLIO_CLIENT_ID),
    clientIdLength: process.env.CLIO_CLIENT_ID?.length || 0,
    clientIdStart: process.env.CLIO_CLIENT_ID?.slice(0, 4) || null,
    clientIdEnd: process.env.CLIO_CLIENT_ID?.slice(-4) || null,

    hasClientSecret: Boolean(process.env.CLIO_CLIENT_SECRET),
    clientSecretLength: process.env.CLIO_CLIENT_SECRET?.length || 0,
    clientSecretStart: process.env.CLIO_CLIENT_SECRET?.slice(0, 4) || null,
    clientSecretEnd: process.env.CLIO_CLIENT_SECRET?.slice(-4) || null,

    redirectUri: process.env.CLIO_REDIRECT_URI || null,
  });
}