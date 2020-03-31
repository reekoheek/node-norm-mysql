const assert = require('assert');
const { Manager } = require('node-norm');
const config = require('../lib/config')();
const NString = require('node-norm/schemas/nstring');
const NInteger = require('node-norm/schemas/ninteger');
const NDouble = require('node-norm/schemas/ndouble');
const NBoolean = require('node-norm/schemas/nboolean');
const NDatetime = require('node-norm/schemas/ndatetime');
const NMap = require('node-norm/schemas/nmap');
const NList = require('node-norm/schemas/nlist');
const NBig = require('node-norm/schemas/nbig');

describe('definition', () => {
  it('check whether defined', async () => {
    class Foo extends NString {}

    const connection = {
      ...config,
      schemas: [
        {
          name: 'foo',
          fields: [
            new NString('fstr'),
            new NInteger('fint'),
            new NDouble('fdbl'),
            new NBoolean('fbol'),
            new NDatetime('fdt'),
            new NMap('fmap'),
            new NList('flst'),
            new NBig('fbig'),
            new Foo('ffoo'),
            new NString('fcustomtype').set('mysql.ddl.type', 'VARCHAR(25)'),
            new NInteger('fextra').set('mysql.ddl.override', 'INT NOT NULL DEFAULT 0'),
          ],
        },
      ],
    };

    const manager = new Manager({ connections: [connection] });

    try {
      await manager.runSession(async session => {
        const conn = await session.acquire();
        try {
          await conn.rawQuery('DROP TABLE IF EXISTS foo');
          await session.flush();

          assert.strictEqual(await session.factory('foo').defined(), false);

          await session.factory('foo').define();
          await session.flush();

          assert.strictEqual(await session.factory('foo').defined(), true);

          await session.factory('foo').undefine();
          await session.flush();

          assert.strictEqual(await session.factory('foo').defined(), false);
        } finally {
          await conn.rawQuery('DROP TABLE IF EXISTS foo');
        }
      });
    } finally {
      await manager.end();
    }
  });
});
