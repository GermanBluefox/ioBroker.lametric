'use strict';

/**
 * getScreens and show of the shared catalog of ioBroker.assistant (family screen): one instance is one clock,
 * show {kind: 'text'} is a notification of the device.
 */

/** The kinds of show a LaMetric can do */
const SCREEN_KINDS = ['text'];

/** Every kind of the catalog; the ones the clock cannot show are answered with NOT_SUPPORTED */
const CATALOG_KINDS = ['image', 'url', 'camera', 'chart', 'text', 'view', 'place', 'qr'];

/** Catalog severity → priority of a LaMetric notification */
const PRIORITIES = { info: 'info', warning: 'warning', alert: 'critical' };

/**
 * A failure in the form of the catalog.
 *
 * @param {string} error text for a human
 * @param {string} reason code
 * @param {{candidates?: string[]}} [extra] further fields
 * @returns {{error: string, reason: string, candidates?: string[]}} the answer
 */
function fail(error, reason, extra) {
    return { error, reason, ...extra };
}

/**
 * Whether `screen` / `room` of a message mean this clock.
 *
 * @param {Record<string, unknown>} message the message
 * @param {{id: string, name: string}} screen this clock
 * @returns {{error: string, reason: string, candidates?: string[]} | null} a failure, or null if the message
 *   means this clock
 */
function matchScreen(message, screen) {
    const wanted = typeof message.screen === 'string' ? message.screen.trim().toLowerCase() : '';
    if (wanted) {
        if (wanted === screen.id.toLowerCase() || wanted === screen.name.toLowerCase()) {
            return null;
        }
        return fail(`no clock "${message.screen}" in this instance`, 'NOT_FOUND', { candidates: [screen.name] });
    }
    if (typeof message.room === 'string' && message.room.trim()) {
        return fail('the clock knows no room: give screen (see getScreens)', 'NOT_SUPPORTED', {
            candidates: [screen.name],
        });
    }
    return null;
}

/**
 * The request for `device/notifications` of a catalog `show {kind: 'text', text, title?, icon?, severity?, seconds?}`.
 *
 * @param {Record<string, unknown>} message the message of show
 * @param {{id: string, name: string}} screen this clock
 * @returns {{data?: {priority?: string, model: object}, error?: {error: string, reason: string}}} the request or a
 *   failure
 */
function showNotification(message, screen) {
    const kind = typeof message.kind === 'string' ? message.kind.trim() : '';
    if (!kind) {
        return { error: fail(`kind missing, one of ${SCREEN_KINDS.join(', ')}`, 'BAD_REQUEST') };
    }
    if (!SCREEN_KINDS.includes(kind)) {
        return {
            error: fail(
                CATALOG_KINDS.includes(kind)
                    ? `the clock cannot show the kind "${kind}", only ${SCREEN_KINDS.join(', ')}`
                    : `unknown kind "${kind}", one of ${SCREEN_KINDS.join(', ')}`,
                'NOT_SUPPORTED',
            ),
        };
    }
    const wrong = matchScreen(message, screen);
    if (wrong) {
        return { error: wrong };
    }
    const text = typeof message.text === 'string' ? message.text.trim() : '';
    if (!text) {
        return { error: fail('text missing', 'BAD_REQUEST') };
    }
    const severity = message.severity === undefined || message.severity === null ? '' : String(message.severity);
    const priority = severity ? PRIORITIES[severity] : '';
    if (severity && !priority) {
        return { error: fail(`unknown severity "${severity}", one of info, warning, alert`, 'BAD_REQUEST') };
    }
    const hasSeconds = message.seconds !== undefined && message.seconds !== null && message.seconds !== '';
    const seconds = Number(message.seconds);
    if (hasSeconds && (!Number.isFinite(seconds) || seconds < 0)) {
        return { error: fail('seconds must be 0 or more', 'BAD_REQUEST') };
    }
    const texts = typeof message.title === 'string' && message.title.trim() ? [message.title.trim(), text] : [text];
    const icon = typeof message.icon === 'string' && message.icon.trim() ? message.icon.trim() : '';
    const model = {
        frames: texts.map(t => (icon ? { text: t, icon } : { text: t })),
        // The device knows no duration, only how often it shows the frames; 0 = until dismissed on the device
        ...(hasSeconds && seconds === 0 ? { cycles: 0 } : {}),
    };
    return { data: priority ? { priority, model } : { model } };
}

/**
 * The answer to a failed request: a text and a code, never the error object (its config carries the API key).
 *
 * @param {unknown} error what buildRequestAsync rejected with
 * @returns {{error: string, reason?: string}} the answer
 */
function errorOf(error) {
    if (typeof error === 'string') {
        return fail(error, 'NOT_CONNECTED');
    }
    const err = Object(error);
    const status = err.response?.status;
    if (status === 401 || status === 403) {
        return fail(`the clock refused the request (${status}): check the API key in the settings`, 'NOT_ALLOWED');
    }
    if (status) {
        return { error: `the clock answered ${status}` };
    }
    if (err.request) {
        return fail(`the clock does not answer (${err.code || 'no response'})`, 'NOT_CONNECTED');
    }
    return { error: typeof err.message === 'string' && err.message ? err.message : 'failed' };
}

module.exports = { SCREEN_KINDS, matchScreen, showNotification, errorOf };
