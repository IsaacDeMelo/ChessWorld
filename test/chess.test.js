const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Load the engine independently of HTTP and the database.
const source = fs.readFileSync(require.resolve('../server'), 'utf8');
const engine = source.slice(source.indexOf('const PIECE_VAL'), source.indexOf('class GameEngine'));
function game(fetch = global.fetch) {
    const ChessGame = vm.runInNewContext(engine + '\nChessGame', { fetch, AbortSignal, console });
    return new ChessGame('test', 'white', 'black', true, 3, false);
}

test('FEN fullmove number starts at one and advances after black moves', () => {
    const g = game();
    assert.ok(g.boardToFEN().endsWith(' 0 1'));
    assert.equal(g.move('white', {r: 6, c: 4}, {r: 4, c: 4}), true);
    assert.ok(g.boardToFEN().endsWith(' 0 1'));
    assert.equal(g.move('black', {r: 1, c: 4}, {r: 3, c: 4}), true);
    assert.ok(g.boardToFEN().endsWith(' 0 2'));
});

test('bot moves a promoting pawn before changing its type', async () => {
    const g = game(async () => ({ok: true, json: async () => ({pvs: [{moves: 'a2a1n'}]})}));
    g.board = Array.from({length: 8}, () => Array(8).fill(null));
    g.board[0][4] = {t: 'k', c: 'b'};
    g.board[7][4] = {t: 'k', c: 'w'};
    g.board[6][0] = {t: 'p', c: 'b'};
    g.turn = 'b';
    await g.makeBotMove();
    assert.equal(g.board[6][0], null);
    assert.equal(g.board[7][0].t, 'n');
    assert.equal(g.moveCount, 1);
});

test('bot falls back to a local move when external services fail', async () => {
    const g = game(async (_, options) => {
        assert.ok(options.signal);
        throw new Error('offline');
    });
    g.move('white', {r: 6, c: 4}, {r: 4, c: 4});
    await g.makeBotMove();
    assert.equal(g.moveCount, 2);
    assert.equal(g.turn, 'w');
});
