import { pythonURI, fetchOptions } from './config.js';
import { withMicroblogRateLimit } from './microblog-rate-limit.js';

/**
 * Microblog API Module
 * Provides reusable functions for interacting with the microblog API
 */

/**
 * Fetch all microblog posts
 * @returns {Promise<Array>} - Resolves to an array of posts or an error
 */
/**
 * Fetch microblog posts, optionally filtered by page
 * @param {string} [page] - Optional page filter
 * @returns {Promise<Array>} - Resolves to an array of posts or an error
 */
export async function fetchPosts(pagePath) {
    let apiUrl = pythonURI + '/api/microblog';
    if (pagePath) {
        // Encode pagePath as a query parameter
        const param = encodeURIComponent(pagePath);
        apiUrl += `?pagePath=${param}`;
    }
    try {
        const response = await fetch(apiUrl, fetchOptions);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        console.log('Microblog posts retrieved:', data);
        return data;
    } catch (error) {
        throw error;
    }
}

/**
 * Create a new microblog post
 * @param {Object} postData - { content, topicId, ... }
 * @returns {Promise<Object>} - Created post or error
 */
export async function createPost(postData) {
    const apiUrl = pythonURI + '/api/microblog';
    const options = {
        ...fetchOptions,
        method: 'POST',
        body: JSON.stringify(postData)
    };
    return withMicroblogRateLimit(() => fetch(apiUrl, options));
}

/**
 * Update an existing microblog post
 * @param {number|string} id - Post ID
 * @param {Object} postData - Fields to update
 * @returns {Promise<Object>} - Updated post or error
 */
export async function updatePost(postData) {
    const apiUrl = pythonURI + `/api/microblog`;
    const options = {
        ...fetchOptions,
        method: 'PUT',
        body: JSON.stringify(postData)
    };
    return withMicroblogRateLimit(() => fetch(apiUrl, options));
}

/**
 * Create a reply to a microblog post
 * @param {Object} replyData - { postId, content, topicPath }
 * @returns {Promise<Object>} - Created reply or error
 */
export async function createReply(replyData) {
    const apiUrl = pythonURI + '/api/microblog/reply';
    const options = {
        ...fetchOptions,
        method: 'POST',
        body: JSON.stringify(replyData)
    };
    return withMicroblogRateLimit(() => fetch(apiUrl, options));
}

/**
 * Fetch replies for a specific post
 * @param {number|string} postId - Post ID to fetch replies for
 * @returns {Promise<Array>} - Array of replies or error
 */
export async function fetchReplies(postId) {
    const apiUrl = pythonURI + `/api/microblog/reply?postId=${postId}`;
    try {
        const response = await fetch(apiUrl, fetchOptions);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        return data;
    } catch (error) {
        throw error;
    }
}

/*
 * Settings-style writes (delete, resolve/reopen markers, DM opt-out) skip the
 * 30-second cooldown in microblog-rate-limit.js: it exists to slow down new
 * content, and resolving a post shouldn't lock someone out of replying.
 */
async function sendWithoutCooldown(path, method, body) {
    const response = await fetch(pythonURI + path, {
        ...fetchOptions,
        method,
        body: JSON.stringify(body)
    });
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
}

/**
 * Delete a microblog post (the server only allows its writer or an Admin)
 * @param {number|string} id - Post ID
 * @returns {Promise<Object>} - Server confirmation or error
 */
export async function deletePost(id) {
    return sendWithoutCooldown('/api/microblog', 'DELETE', { id });
}

/*
 * Page-author DM opt-out.
 *
 * Saved as a marker post on the page's topic. Unlike replies, posts carry the
 * server-stamped `userUid` of their writer, so nobody can turn DMs off for
 * someone else. Turning DMs back on deletes the marker post.
 */
const DM_OFF_MARKER = '[[microblog:dm-off]]';

/**
 * @param {Object} post - A post from the API
 * @returns {boolean} - true when the post is a DM opt-out marker, not a real post
 */
export function isDmOptOutPost(post) {
    return ((post && post.content) || '').startsWith(DM_OFF_MARKER);
}

/**
 * Fetch the DM opt-out markers for a page
 * @param {string} topicPath - The page's permalink
 * @returns {Promise<Array>} - Marker posts; each `userUid` has DMs turned off
 */
export async function fetchDmOptOutPosts(topicPath) {
    const data = await fetchPosts(topicPath);
    return (data.microblogs || []).filter(isDmOptOutPost);
}

/**
 * Turn page-author DMs off or back on for the signed-in user
 * @param {string} topicPath - The page's permalink
 * @param {boolean} optOut - true turns DMs off, false turns them back on
 * @param {Object} [existingOptOut] - The user's current marker post, needed to turn DMs back on
 * @returns {Promise<Object|null>} - The new marker post when turning DMs off
 */
export async function setDmOptOut(topicPath, optOut, existingOptOut) {
    if (optOut) return sendWithoutCooldown('/api/microblog', 'POST', { content: DM_OFF_MARKER, topicPath });
    if (existingOptOut) await deletePost(existingOptOut.id);
    return null;
}

/**
 * Fetch the signed-in Flask user ({ id, uid, name, ... })
 * @returns {Promise<Object|null>} - The user, or null when signed out
 */
export async function fetchCurrentUser() {
    try {
        const response = await fetch(pythonURI + '/api/id', fetchOptions);
        return response.ok ? await response.json() : null;
    } catch (error) {
        console.warn('Microblog: could not load the signed-in user', error);
        return null;
    }
}

/*
 * Resolved / reopened status.
 *
 * The Flask API only lets a post's writer (or an Admin) edit a post, but any
 * signed-in user can reply. So a status change is saved as a marker reply:
 * the server stamps who sent it, and the panel hides markers from the reply
 * list. The latest marker from the post's writer or a page author wins.
 */
const RESOLVED_MARKER = '[[microblog:resolved]]';
const REOPENED_MARKER = '[[microblog:reopened]]';

/**
 * Mark a post resolved or reopen it
 * @param {number|string} postId - Post to update
 * @param {boolean} resolved - true to resolve, false to reopen
 * @param {string} resolverUid - uid of the person changing the status
 */
export async function setPostResolved(postId, resolved, resolverUid) {
    const marker = resolved ? RESOLVED_MARKER : REOPENED_MARKER;
    return sendWithoutCooldown('/api/microblog/reply', 'POST', { postId, content: `${marker} ${resolverUid}` });
}

/**
 * @param {Object} reply - A reply from the API
 * @returns {boolean} - true when the reply is a status marker, not a real reply
 */
export function isStatusMarker(reply) {
    const content = (reply && reply.content) || '';
    return content.startsWith(RESOLVED_MARKER) || content.startsWith(REOPENED_MARKER);
}

/**
 * Work out whether a post is resolved from its marker replies.
 *
 * A marker counts when its sender is the post's writer (checked against the
 * server-stamped userId) or claims a uid listed as a page author. The uid
 * claim can't be checked server-side, so a crafted request could still hide a
 * post from the Active view; it stays visible under History either way.
 *
 * @param {Object} post - Post with its `replies` array
 * @param {string[]} pageAuthorUids - uids allowed to resolve this post
 * @returns {{ resolved: boolean, by: string|null, at: string|null }}
 */
export function getResolution(post, pageAuthorUids) {
    let resolution = { resolved: false, by: null, at: null };
    for (const reply of (post.replies || [])) {
        if (!isStatusMarker(reply)) continue;
        const [marker, claimedUid] = reply.content.trim().split(/\s+/);
        const bySubmitter = reply.userId === post.userId;
        const byPageAuthor = claimedUid && pageAuthorUids.includes(claimedUid);
        if (!bySubmitter && !byPageAuthor) continue;
        resolution = {
            resolved: marker === RESOLVED_MARKER,
            by: reply.userName || claimedUid || null,
            at: reply.timestamp || null
        };
    }
    return resolution;
}
