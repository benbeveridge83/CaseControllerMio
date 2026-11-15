// Microsoft Graph mail + calendar + OneDrive helpers for the email dashboard.
// Reuses the shared graphRequest client from the Paralegal Microsoft foundation.
//
// A mailbox is read through the token that was connected for it. When the
// connected account is the signed-in user itself we use the "/me" shortcut;
// when it is a shared mailbox we address it by "/users/{email}" using the
// connected account's token (which must carry Mail.Read.Shared).

import { graphRequest } from '../paralegal/microsoft/graph.js'

function userPath(accountEmail) {
  const email = String(accountEmail || '').trim().toLowerCase()
  if (!email) return '/me'
  return `/users/${email}`
}

export function getMe({ accessToken, fetchImpl }) {
  return graphRequest({ accessToken, path: '/me', fetchImpl })
}

export function listMailFolders({ accessToken, accountEmail, fetchImpl }) {
  return graphRequest({ accessToken, path: `${userPath(accountEmail)}/mailFolders`, query: { $top: 50 }, fetchImpl })
}

export function listChildFolders({ accessToken, accountEmail, parentId, fetchImpl }) {
  return graphRequest({ accessToken, path: `${userPath(accountEmail)}/mailFolders/${encodeURIComponent(parentId)}/childFolders`, query: { $top: 50 }, fetchImpl })
}

export function listFolderMessages({ accessToken, accountEmail, folderId, query = {}, fetchImpl }) {
  const q = { $top: 50, $select: 'id,subject,from,toRecipients,ccRecipients,receivedDateTime,hasAttachments,isRead,parentFolderId,bodyPreview', ...query }
  return graphRequest({ accessToken, path: `${userPath(accountEmail)}/mailFolders/${encodeURIComponent(folderId)}/messages`, query: q, fetchImpl })
}

export function getMessage({ accessToken, accountEmail, messageId, fetchImpl }) {
  return graphRequest({ accessToken, path: `${userPath(accountEmail)}/messages/${encodeURIComponent(messageId)}`, fetchImpl })
}

export function getCalendarView({ accessToken, accountEmail, startDateTime, endDateTime, fetchImpl }) {
  return graphRequest({
    accessToken,
    path: `${userPath(accountEmail)}/calendarview`,
    query: { startDateTime, endDateTime, $top: 20, $select: 'subject,start,end,organizer' },
    fetchImpl,
  })
}

export function searchOneDrive({ accessToken, accountEmail, query, fetchImpl }) {
  return graphRequest({
    accessToken,
    path: `${userPath(accountEmail)}/drive/root/search(q='${encodeURIComponent(query)}')`,
    query: { $top: 10, $select: 'name,webUrl,lastModifiedDateTime' },
    fetchImpl,
  })
}
