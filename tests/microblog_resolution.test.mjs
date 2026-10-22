import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Load a browser module with its imports swapped for stubs (config.js has Jekyll front matter)
async function loadWithStubs(path, stubs) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8');
    const body = source.replace(/^import .*$/gm, '');
    return import(`data:text/javascript;base64,${Buffer.from(stubs + body).toString('base64')}`);
}

const microblog = await loadWithStubs('../assets/js/api/microblog.js',
    "const pythonURI = ''; const fetchOptions = {}; const withMicroblogRateLimit = () => {};\n");
const notify = await loadWithStubs('../assets/js/api/microblog-notify.js',
    "const javaURI = ''; const fetchOptions = {};\n");

const reply = (content, userId) => ({ content, userId, userName: `user${userId}`, timestamp: '2026-10-01T00:00:00' });

test('resolve markers count only from the post writer or a page author, latest wins', () => {
    const authors = ['author1'];
    const resolved = replies => microblog.getResolution({ userId: 20, replies }, authors).resolved;

    assert.equal(resolved([]), false);
    assert.equal(resolved([reply('normal reply', 30)]), false);
    assert.equal(resolved([reply('[[microblog:resolved]] author1', 10)]), true, 'page author');
    assert.equal(resolved([reply('[[microblog:resolved]] student2', 20)]), true, 'post writer, by server-stamped userId');
    assert.equal(resolved([reply('[[microblog:resolved]] nobody', 40)]), false, 'neither writer nor author');
    assert.equal(resolved([
        reply('[[microblog:resolved]] author1', 10),
        reply('[[microblog:reopened]] student2', 20)
    ]), false, 'a later reopen wins');
    assert.equal(resolved([
        reply('[[microblog:reopened]] student2', 20),
        reply('[[microblog:resolved]] nobody', 40)
    ]), false, 'an ignored marker does not override');
});

test('status markers and DM opt-out posts are told apart from real content', () => {
    assert.equal(microblog.isStatusMarker(reply('[[microblog:resolved]] a', 1)), true);
    assert.equal(microblog.isStatusMarker(reply('[[microblog:reopened]] a', 1)), true);
    assert.equal(microblog.isStatusMarker(reply('I resolved it with [[microblog:resolved]]', 1)), false);
    assert.equal(microblog.isStatusMarker(null), false);
    assert.equal(microblog.isDmOptOutPost({ content: '[[microblog:dm-off]]' }), true);
    assert.equal(microblog.isDmOptOutPost({ content: 'please turn dm-off' }), false);
    assert.equal(microblog.isDmOptOutPost(null), false);
});

test('authors front matter normalizes from a list or a comma string', () => {
    assert.deepEqual(notify.normalizeAuthorUids(['author1', ' author2 ', 'author1', '']), ['author1', 'author2']);
    assert.deepEqual(notify.normalizeAuthorUids('author1, author2'), ['author1', 'author2']);
    assert.deepEqual(notify.normalizeAuthorUids(null), []);
});
