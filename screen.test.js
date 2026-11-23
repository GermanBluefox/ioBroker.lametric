'use strict';

const { describe, it } = require('mocha');
const { expect } = require('chai');
const { matchScreen, showNotification, errorOf } = require('./lib/screen');

const screen = { id: 'lametric.0', name: 'Kitchen clock' };

describe('screen.show as a notification', () => {
    it('maps text, title, icon, severity and seconds 0 onto the request of the device', () => {
        expect(showNotification({ kind: 'text', text: 'Washer done' }, screen)).to.deep.equal({
            data: { model: { frames: [{ text: 'Washer done' }] } },
        });
        const { data } = showNotification(
            {
                kind: 'text',
                text: ' Door open ',
                title: 'Alarm',
                icon: 'i3389',
                severity: 'alert',
                seconds: 0,
                screen: 'kitchen CLOCK',
            },
            screen,
        );
        expect(data).to.deep.equal({
            priority: 'critical',
            model: {
                frames: [
                    { text: 'Alarm', icon: 'i3389' },
                    { text: 'Door open', icon: 'i3389' },
                ],
                cycles: 0,
            },
        });
        expect(showNotification({ kind: 'text', text: 'x', seconds: 20 }, screen).data).to.deep.equal({
            model: { frames: [{ text: 'x' }] },
        });
        expect(showNotification({ kind: 'text', text: 'x', severity: 'warning' }, screen).data?.priority).to.equal(
            'warning',
        );
    });

    it('refuses with the codes of the catalog', () => {
        const reason = message => showNotification(message, screen).error?.reason;
        expect(reason({ kind: 'image', image: 'data:image/png;base64,AAAA' })).to.equal('NOT_SUPPORTED');
        expect(reason({ kind: 'camera', camera: 'door', instance: 'cameras.0' })).to.equal('NOT_SUPPORTED');
        expect(reason({ kind: 'chart', ids: ['a.0.b'] })).to.equal('NOT_SUPPORTED');
        expect(reason({ text: 'no kind' })).to.equal('BAD_REQUEST');
        expect(reason({ kind: 'text' })).to.equal('BAD_REQUEST');
        expect(reason({ kind: 'text', text: 'x', severity: 'loud' })).to.equal('BAD_REQUEST');
        expect(reason({ kind: 'text', text: 'x', seconds: -1 })).to.equal('BAD_REQUEST');
        expect(reason({ kind: 'text', text: 'x', screen: 'lametric.1' })).to.equal('NOT_FOUND');
        expect(reason({ kind: 'text', text: 'x', room: 'Kitchen' })).to.equal('NOT_SUPPORTED');
        expect(matchScreen({ screen: 'LAMETRIC.0' }, screen)).to.equal(null);
        expect(matchScreen({ screen: 'Living room' }, screen)?.candidates).to.deep.equal(['Kitchen clock']);
    });

    it('answers a failed request with a text, never with the error object and its API key', () => {
        const axiosError = Object.assign(new Error('Request failed with status code 401'), {
            response: { status: 401 },
            config: { auth: { username: 'dev', password: 'secret-token' } },
        });
        const answer = errorOf(axiosError);
        expect(answer.reason).to.equal('NOT_ALLOWED');
        expect(JSON.stringify(answer)).not.to.contain('secret-token');
        expect(Object.values(answer).every(v => typeof v === 'string')).to.equal(true);
        expect(errorOf(Object.assign(new Error('timeout'), { request: {}, code: 'ECONNABORTED' })).reason).to.equal(
            'NOT_CONNECTED',
        );
        expect(errorOf('Device IP and/or token is not configured').reason).to.equal('NOT_CONNECTED');
        expect(errorOf(Object.assign(new Error('x'), { response: { status: 500 } }))).to.deep.equal({
            error: 'the clock answered 500',
        });
    });
});

describe('getScreens and show of the adapter', () => {
    /**
     * The adapter with a fake adapter-core, fake states and a fake device
     *
     * @param {(data: unknown) => Promise<unknown>} request answers buildRequestAsync
     */
    function adapter(request) {
        const corePath = require.resolve('@iobroker/adapter-core');
        const saved = require.cache[corePath];
        class Adapter {
            constructor() {
                this.namespace = 'lametric.0';
                this.log = { debug() {}, info() {}, warn() {}, error() {} };
            }
            on() {}
        }
        require.cache[corePath] = /** @type {any} */ ({ id: corePath, filename: corePath, exports: { Adapter } });
        delete require.cache[require.resolve('./main')];
        try {
            /** @type {any} */
            const a = require('./main')({});
            const states = { 'meta.name': 'Kitchen clock', 'info.connection': true };
            a.getStateAsync = async id => (id in states ? { val: states[id], ack: true } : null);
            a.requests = [];
            a.buildRequestAsync = async (service, method, data) => {
                a.requests.push({ service, method, data });
                return request(data);
            };
            a.call = (command, message, callback = { id: 1 }) =>
                new Promise(resolve => {
                    a.sendTo = (to, cmd, answer) => resolve(answer);
                    a.onMessage({ command, message, from: 'system.adapter.assistant.0', callback });
                    if (!callback) {
                        setTimeout(() => resolve(undefined), 20);
                    }
                });
            return a;
        } finally {
            if (saved) {
                require.cache[corePath] = saved;
            } else {
                delete require.cache[corePath];
            }
            delete require.cache[require.resolve('./main')];
        }
    }

    it('lists the clock and shows a text', async () => {
        const a = adapter(async () => ({ data: { success: { id: 52 } } }));
        expect(await a.call('getScreens', {})).to.deep.equal({
            screens: [{ id: 'lametric.0', name: 'Kitchen clock', online: true, kinds: ['text'] }],
        });
        expect(await a.call('show', { kind: 'text', text: 'Hello', screen: 'lametric.0' })).to.deep.equal({
            ok: true,
            id: '52',
            screens: ['Kitchen clock'],
        });
        expect(a.requests).to.deep.equal([
            { service: 'device/notifications', method: 'POST', data: { model: { frames: [{ text: 'Hello' }] } } },
        ]);
        await a.call('show', { kind: 'text', text: 'without callback' }, null);
        expect(a.requests).to.have.length(2);
    });

    it('does not ask the device for a kind it cannot show, and hides the API key of a failure', async () => {
        const a = adapter(async () => {
            throw Object.assign(new Error('Request failed with status code 401'), {
                response: { status: 401 },
                config: { auth: { password: 'secret-token' } },
            });
        });
        expect((await a.call('show', { kind: 'image', image: 'data:image/png;base64,AAAA' })).reason).to.equal(
            'NOT_SUPPORTED',
        );
        expect(a.requests).to.have.length(0);
        const answer = await a.call('show', { kind: 'text', text: 'x' });
        expect(answer.reason).to.equal('NOT_ALLOWED');
        expect(JSON.stringify(answer)).not.to.contain('secret-token');
    });
});
