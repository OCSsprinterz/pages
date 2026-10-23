import { javaURI, fetchOptions } from './config.js';

/**
 * Microblog -> page author DMs
 *
 * When someone posts or replies on a page's microblog, each uid in the page's
 * `authors:` front matter gets a 1:1 direct message through the Spring DM API
 * (/api/dm/conversations). The sender has to be signed in to Spring as well
 * as Flask; guests who only signed up through the microblog panel are Flask-only.
 * Callers drop authors who turned DMs off for the page before calling this.
 */

async function springRequest(path, method = 'GET', body) {
    const response = await fetch(`${javaURI}${path}`, {
        ...fetchOptions,
        method,
        cache: 'no-store',
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (!response.ok) {
        const error = new Error(`Spring ${method} ${path} failed: ${response.status}`);
        error.status = response.status;
        throw error;
    }
    return response.status === 204 ? null : response.json();
}

async function sendDirectMessage(authorUid, body) {
    const person = await springRequest(`/api/person/uid/${encodeURIComponent(authorUid)}`);
    const conversation = await springRequest('/api/dm/conversations', 'POST', { otherPersonIds: [person.id] });
    await springRequest(`/api/dm/conversations/${conversation.id}/messages`, 'POST', { body });
}

/**
 * Normalize the `authors:` front matter, which may be a list or a comma string
 * @param {string|string[]|null} authors - Value of page.authors
 * @returns {string[]} - Unique, trimmed uids
 */
export function normalizeAuthorUids(authors) {
    const list = Array.isArray(authors) ? authors : String(authors || '').split(',');
    return [...new Set(list.map(uid => String(uid).trim()).filter(Boolean))];
}

/**
 * DM every page author (except the sender) about a new post or reply
 * @param {Object} notice
 * @param {string[]} notice.authorUids - Page author uids
 * @param {string} [notice.senderUid] - The poster's uid; they are never DM'd
 * @param {string} notice.senderName - Shown in the DM
 * @param {'post'|'reply'} notice.kind - What was added
 * @param {string} notice.pageTitle - Page the post is on
 * @param {string} notice.pageUrl - Link back to the page
 * @param {string} notice.content - The post or reply text
 * @returns {Promise<{ sent: number, failed: number, signedOut: boolean }>}
 */
export async function notifyPageAuthors({ authorUids, senderUid, senderName, kind, pageTitle, pageUrl, content }) {
    const recipients = authorUids.filter(uid => uid !== senderUid);
    const action = kind === 'reply' ? 'replied on the microblog for' : 'posted on the microblog for';
    const snippet = content.length > 200 ? `${content.slice(0, 200)}…` : content;
    const body = `${senderName || 'Someone'} ${action} your page "${pageTitle}":\n\n"${snippet}"\n\n${pageUrl}\n\n` +
        `Don't want these messages? Open the Microblog on that page and uncheck ` +
        `"DM me about new posts and replies on this page" to turn them off.`;

    const results = await Promise.allSettled(recipients.map(uid => sendDirectMessage(uid, body)));
    const failures = results.filter(result => result.status === 'rejected');
    failures.forEach(failure => console.warn('Microblog: could not DM a page author', failure.reason));
    return {
        sent: results.length - failures.length,
        failed: failures.length,
        // Spring answers an anonymous caller with 401 or 403 depending on the route
        signedOut: failures.some(failure => failure.reason && [401, 403].includes(failure.reason.status))
    };
}
