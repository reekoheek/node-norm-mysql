const assert = require('assert');
const { Manager } = require('node-norm');
const Big = require('big.js');
const {
  NBig,
  NBoolean,
  NDatetime,
  NDouble,
  NInteger,
  NList,
  NMap,
  NString,
} = require('node-norm/schemas');

const config = require('../lib/config')({
  schemas: [
    {
      name: 'foo',
      fields: [
        new NBig('nbig'),
        new NBoolean('nboolean'),
        new NDatetime('ndatetime'),
        new NDouble('ndouble'),
        new NInteger('ninteger'),
        new NList('nlist'),
        new NMap('nmap'),
        new NString('nstring'),
      ],
    },
  ],
});
const query = require('../lib/query')(config);

describe('cases with schema', () => {
  beforeEach(async () => {
    await query('DROP TABLE IF EXISTS foo');
    await query(`
CREATE TABLE foo (
  id INT AUTO_INCREMENT,
  nbig VARCHAR(100),
  nboolean INT,
  ndatetime DATETIME,
  ndouble DOUBLE,
  ninteger INT,
  nlist TEXT,
  nmap TEXT,
  nstring VARCHAR(100),
  nfield VARCHAR(100),
  PRIMARY KEY (id)
)
    `);
    await query(
      `
INSERT INTO foo (nbig, nboolean, ndatetime, ndouble, ninteger, nlist, nmap, nstring, nfield)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ? )
      `,
      [
        '123.456',
        true,
        '2018-11-21',
        12.34,
        1234,
        '["foo", "bar"]',
        '{"foo":"bar"}',
        'foobar',
        'custom-field',
      ],
    );
  });

  // afterEach(async () => {
  //   await query('DROP TABLE foo');
  // });

  it('create new record', async () => {
    const manager = new Manager({ connections: [config] });

    try {
      await manager.runSession(async session => {
        const { affected, rows } = await session.factory('foo')
          .insert({
            nbig: 12.34,
            nboolean: '',
            ndatetime: new Date('2019-02-06T00:00:00.000Z'),
            ndouble: 1.234,
            ninteger: 1234,
            nlist: ['foo', 'bar'],
            nmap: { foo: 'bar' },
            nstring: 'foobar',
            nfield: 'foobar-field',
          })
          .save();

        assert.strictEqual(affected, 1);
        assert.strictEqual(rows.length, 1);
      });

      const { results } = await query('SELECT * from foo');
      assert.strictEqual(results.length, 2);
    } finally {
      await manager.end();
    }
  });

  it('create new record with default empty columns', async () => {
    const manager = new Manager({ connections: [config] });

    try {
      await manager.runSession(async session => {
        const { affected, rows } = await session.factory('foo')
          .insert({
            nbig: 12.34,
          })
          .save();

        assert.strictEqual(affected, 1);
        assert.strictEqual(rows.length, 1);
      });

      const { results } = await query('SELECT * from foo');
      assert.strictEqual(results.length, 2);
    } finally {
      await manager.end();
    }
  });

  it('read record', async () => {
    const manager = new Manager({ connections: [config] });
    try {
      await manager.runSession(async session => {
        const foos = await session.factory('foo').all();
        assert.strictEqual(foos.length, 1);
        assert(foos[0].nbig instanceof Big);
        assert.strictEqual(foos[0].nboolean, true);
        assert.strictEqual(foos[0].ndatetime.toISOString(), new Date('2018-11-21 00:00:00').toISOString());
        assert.strictEqual(foos[0].ndouble, 12.34);
        assert.strictEqual(foos[0].ninteger, 1234);
        assert.deepStrictEqual(foos[0].nlist, ['foo', 'bar']);
        assert.deepStrictEqual(foos[0].nmap, { foo: 'bar' });
        assert.strictEqual(foos[0].nfield, 'custom-field');
      });
    } finally {
      await manager.end();
    }
  });

  it('update record', async () => {
    const manager = new Manager({ connections: [config] });
    try {
      await manager.runSession(async session => {
        const { affected } = await session.factory('foo', 1).set({
          nbig: 12.34,
          nboolean: false,
          ndatetime: new Date('2018-11-21 00:00:00'),
          ndouble: 1.234,
          ninteger: 1234,
          nlist: ['foo', 'bar'],
          nmap: { foo: 'bar' },
          nstring: 'foobar',
          nfield: 'custom-field',
        }).save();
        assert.strictEqual(affected, 1);
      });

      const { results } = await query('SELECT * FROM foo WHERE id = 1');
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].nbig, '12.34');
      assert.strictEqual(results[0].nboolean, 0);
      assert.strictEqual(results[0].ndatetime.toISOString(), new Date('2018-11-21 00:00:00').toISOString());
      assert.strictEqual(results[0].ndouble, 1.234);
      assert.strictEqual(results[0].ninteger, 1234);
      assert.deepStrictEqual(JSON.parse(results[0].nlist), ['foo', 'bar']);
      assert.deepStrictEqual(JSON.parse(results[0].nmap), { foo: 'bar' });
      assert.strictEqual(results[0].nfield, 'custom-field');
    } finally {
      await manager.end();
    }
  });
});
