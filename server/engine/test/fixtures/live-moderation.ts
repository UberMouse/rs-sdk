import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { EventEmitter } from 'node:events';

class TestWorker extends EventEmitter {
    postMessage() {}
}
mock.module('worker_threads', () => ({ Worker: TestWorker }));

const { default: World } = await import('../../src/engine/World.js');
const { default: Environment } = await import('../../src/util/Environment.js');
const { default: ClientCheatHandler } = await import('../../src/network/game/client/handler/ClientCheatHandler.js');
const { default: ClientCheat } = await import('../../src/network/game/client/model/ClientCheat.js');
const { NetworkPlayer } = await import('../../src/engine/entity/NetworkPlayer.js');
const { default: WSClientSocket } = await import('../../src/server/ws/WSClientSocket.js');

const originalProduction = Environment.node.production;
afterEach(() => {
    mock.restore();
    Environment.node.production = originalProduction;
});

function staff(level: number) {
    return { staffModLevel: level, username: 'moderator', addSessionLog: mock(() => {}), messageGame: mock(() => {}) } as any;
}

for (const production of [false, true]) {
    test(`staff can kick through the normal logout path, production=${production}`, () => {
        Environment.node.production = production;
        const client = new WSClientSocket();
        const target = new NetworkPlayer('target', 1n, 1n, client);
        const logout = spyOn(target, 'logout').mockImplementation(() => {});
        const close = spyOn(client, 'close').mockImplementation(() => {});
        spyOn(World, 'getPlayerByUsername').mockReturnValue(target);
        new ClientCheatHandler().handle(new ClientCheat('kick target'), staff(2));
        expect(target.loggingOut).toBe(true);
        expect(logout).toHaveBeenCalledTimes(1);
        expect(close).toHaveBeenCalledTimes(1);
    });

    test(`staff can ban immediately, production=${production}`, () => {
        Environment.node.production = production;
        const ban = spyOn(World, 'notifyPlayerBan').mockImplementation(() => {});
        const before = Date.now();
        new ClientCheatHandler().handle(new ClientCheat('ban target 60'), staff(2));
        expect(ban).toHaveBeenCalledTimes(1);
        expect(ban.mock.calls[0][0]).toBe('moderator');
        expect(ban.mock.calls[0][1]).toBe('target');
        expect(ban.mock.calls[0][2]).toBeGreaterThanOrEqual(before + 60 * 60_000);
    });

    test(`players below moderator level cannot kick or ban, production=${production}`, () => {
        Environment.node.production = production;
        const lookup = spyOn(World, 'getPlayerByUsername');
        const ban = spyOn(World, 'notifyPlayerBan');
        const handler = new ClientCheatHandler();
        for (const level of [0, 1]) {
            handler.handle(new ClientCheat('kick target'), staff(level));
            handler.handle(new ClientCheat('ban target 60'), staff(level));
        }
        expect(lookup).not.toHaveBeenCalled();
        expect(ban).not.toHaveBeenCalled();
    });
}
