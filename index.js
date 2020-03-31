const Connection = require('node-norm/connection');
const mysql2 = require('mysql2/promise');
const debug = require('debug')('node-norm-mysql:index');
const debugQuery = require('debug')('node-norm-mysql:query');

const OPERATORS = {
  ne: '!=',
  eq: '=',
  gt: '>',
  lt: '<',
  gte: '>=',
  lte: '<=',
  like: 'like',
};

const DEFAULT_TYPES = {
  nstring: 'VARCHAR(255)',
  nreference: 'VARCHAR(255)',
  ninteger: 'INT',
  ndouble: 'DOUBLE',
  ndatetime: 'DATETIME',
  nboolean: 'TINYINT',
  nlist: 'TEXT',
  nmap: 'TEXT',
  ntext: 'TEXT',
  nbig: 'DECIMAL(25,8)',
};

const FALLBACK_TYPE = 'VARCHAR(255)';

class Mysql extends Connection {
  constructor (options) {
    super(options);

    const { host, user, password, database } = options;
    this.host = host;
    this.user = user;
    this.password = password;
    this.database = database;
  }

  getConnection () {
    console.warn('Deprecated #getConnection(), use #getRaw() instead');

    return this.getRaw();
  }

  getRaw () {
    if (!this.connPromise) {
      const { host, user, password, database } = this;
      this.connPromise = mysql2.createConnection({ host, user, password, database, enableKeepAlive: true });
      this.connPromise.then(conn => conn.on('error', this.dbOnError.bind(this)));
    }

    return this.connPromise;
  }

  dbOnError (err) {
    debug('Database error', err);

    // Connection to the MySQL server is usually
    // lost due to either server restart
    if (err.code === 'PROTOCOL_CONNECTION_LOST') {
      this.connPromise = undefined;
      console.error('Connection already ended, will be reinstantiate for next query');
      return;
    }

    throw err;
  }

  dbQuery (sql, params) {
    console.warn('Deprecated #dbQuery(), use #rawQuery() instead');

    return this.rawQuery(sql, params);
  }

  async rawQuery (sql, params) {
    if (debugQuery.enabled) {
      debugQuery('SQL %s', sql);
      debugQuery('??? %o', params);
    }
    const conn = await this.getRaw();
    const [result, fields] = await conn.execute(sql, params);
    return { result, fields };
  }

  getFieldNamesFromSchemaOrRow (query) {
    let fieldNames = query.schema.fields.map(field => field.name);
    if (!fieldNames.length) {
      fieldNames = query.rows.reduce((fieldNames, row) => {
        for (const f in row) {
          if (fieldNames.indexOf(f) === -1) {
            fieldNames.push(f);
          }
        }
        return fieldNames;
      }, []);
    }
    return fieldNames;
  }

  async insert (query, callback = () => {}) {
    const fieldNames = this.getFieldNamesFromSchemaOrRow(query);

    const placeholder = fieldNames.map(f => '?').join(', ');
    const sql = `INSERT INTO ${mysql2.escapeId(query.schema.name)}` +
      ` (${fieldNames.map(f => mysql2.escapeId(f)).join(', ')})` +
      ` VALUES (${placeholder})`;

    let changes = 0;
    await Promise.all(query.rows.map(async row => {
      const rowData = fieldNames.map(f => {
        const value = this.serialize(row[f]);
        return value;
      });

      const { result } = await this.rawQuery(sql, rowData);
      row.id = result.insertId;
      changes += result.affectedRows;

      callback(row);
    }));

    return changes;
  }

  async load (query, callback = () => {}) {
    const sqlArr = [`SELECT * FROM ${mysql2.escapeId(query.schema.name)}`];
    const [wheres, data] = this.getWhere(query);
    if (wheres) {
      sqlArr.push(wheres);
    }

    const orderBys = this.getOrderBy(query);
    if (orderBys) {
      sqlArr.push(orderBys);
    }

    // mysql behavior if limit not set and skip set, limit will set default to 1000
    if (query.length < 0 && query.offset > 0) {
      query.length = 1000;
    }

    if (query.length > 0) {
      sqlArr.push(`LIMIT ${query.length}`);
    }
    if (query.offset > 0) {
      sqlArr.push(`OFFSET ${query.offset}`);
    }

    const sql = sqlArr.join(' ');

    const { result } = await this.rawQuery(sql, data);
    return result.map(row => {
      callback(row);
      return row;
    });
  }

  async delete (query, callback) {
    const [wheres, data] = this.getWhere(query);
    const sqlArr = [`DELETE FROM ${mysql2.escapeId(query.schema.name)}`];
    if (wheres) {
      sqlArr.push(wheres);
    }

    const sql = sqlArr.join(' ');

    await this.rawQuery(sql, data);
  }

  getOrderBy (query) {
    const orderBys = [];
    for (const key in query.sorts) {
      const val = query.sorts[key];
      orderBys.push(`${mysql2.escapeId(key)} ${val > 0 ? 'ASC' : 'DESC'}`);
    }

    if (!orderBys.length) {
      return;
    }

    return `ORDER BY ${orderBys.join(', ')}`;
  }

  async update (query) {
    const keys = Object.keys(query.sets);

    let params = keys.map(k => this.serialize(query.sets[k]));
    const placeholder = keys.map(k => `${mysql2.escapeId(k)} = ?`).join(', ');

    const sqlArr = [`UPDATE ${mysql2.escapeId(query.schema.name)} SET ${placeholder}`];
    const [wheres, data] = this.getWhere(query);
    if (wheres) {
      sqlArr.push(wheres);
      params = params.concat(data);
    }

    const sql = sqlArr.join(' ');

    const { result } = await this.rawQuery(sql, params);

    return result.affectedRows;
  }

  getOr (query) {
    const wheres = [];
    let datas = [];
    for (let i = 0; i < query.length; i++) {
      if (Object.keys(query[i]).length > 1) {
        const { where, data } = this.getAnd(query[i]);
        wheres.push(where);
        datas = datas.concat(data);
        continue;
      }
      const key = Object.keys(query[i])[0];
      let value = Object.values(query[i])[0];
      const [field, operator = 'eq'] = key.split('!');
      if (operator === 'like') {
        value = '%' + value + '%';
      }
      datas.push(value);
      wheres.push(`${mysql2.escapeId(field)} ${OPERATORS[operator]} ?`);
    }
    return { where: `(${wheres.join(' OR ')})`, data: datas };
  }

  getAnd (query) {
    const wheres = [];
    let data = [];
    for (const key in query) {
      let value = query[key];

      if (key === '!or') {
        const or = this.getOr(value);
        wheres.push(or.where);
        data = data.concat(or.data);
        continue;
      }

      const [field, operator = 'eq'] = key.split('!');

      // add by januar: for chek if operator like value change to %
      if (operator === 'like') {
        value = `%${value}%`;
      }

      data.push(value);
      wheres.push(`${mysql2.escapeId(field)} ${OPERATORS[operator]} ?`);
    }
    return { where: `(${wheres.join(' AND ')})`, data };
  }

  getWhere (query) {
    const wheres = [];
    let data = [];
    for (const key in query.criteria) {
      let value = query.criteria[key];

      if (key === '!or') {
        const or = this.getOr(value);
        wheres.push(or.where);
        data = data.concat(or.data);
        continue;
      }

      const [field, operator = 'eq'] = key.split('!');

      // add by januar: for chek if operator like value change to %
      if (operator === 'like') {
        value = `%${value}%`;
      }

      data.push(value);
      wheres.push(`${mysql2.escapeId(field)} ${OPERATORS[operator]} ?`);
    }

    if (!wheres.length) {
      return [];
    }

    return [`WHERE ${wheres.join(' AND ')}`, data];
  }

  async _begin () {
    const conn = await this.getRaw();
    await conn.beginTransaction();
  }

  async _commit () {
    const conn = await this.getRaw();
    await conn.commit();
  }

  async _rollback () {
    const conn = await this.getRaw();
    await conn.rollback();
  }

  async count (query, useSkipAndLimit = false) {
    const sqlArr = [`SELECT * FROM ${mysql2.escapeId(query.schema.name)}`];
    const [wheres, data] = this.getWhere(query);
    if (wheres) {
      sqlArr.push(wheres);
    }

    if (useSkipAndLimit) {
      if (query.length >= 0) {
        sqlArr.push(`LIMIT ${query.length}`);
      }

      if (query.offset > 0) {
        sqlArr.push(`OFFSET ${query.offset}`);
      }
    }

    const sql = `SELECT COUNT(*) AS ${mysql2.escapeId('count')} FROM (${sqlArr.join(' ')}) AS a`;
    const { result: [row] } = await this.rawQuery(sql, data);
    return row.count;
  }

  async end () {
    const conn = await this.getRaw();
    this.connPromise = undefined;
    await conn.end();
  }

  serialize (value) {
    if (value === null || value === undefined) {
      return null;
    }

    if (value instanceof Date) {
      return value;
      // return value.toISOString().slice(0, 19).replace('T', ' ');
    }

    if (typeof value === 'object') {
      if (typeof value.toJSON === 'function') {
        return value.toJSON();
      } else {
        return JSON.stringify(value);
      }
    }

    return value;
  }

  async defined ({ name }) {
    try {
      await this.rawQuery(`SELECT 1 FROM ${mysql2.escapeId(name)} LIMIT 1`);
      return true;
    } catch (err) {
      return false;
    }
  }

  async define ({ name, fields }) {
    const fieldLines = fields.map(field => {
      const overridden = field.get('mysql.ddl.override');
      if (overridden) {
        return `${mysql2.escapeId(field.name)} ${overridden.trim()}`;
      }

      const schemaType = field.constructor.name.toLowerCase();
      const dataType = field.get('mysql.ddl.type') || DEFAULT_TYPES[schemaType] || FALLBACK_TYPE;
      const lineTokens = [`${mysql2.escapeId(field.name)} ${dataType}`];
      lineTokens.push(`${getFilter(field, 'required') ? 'NOT NULL' : 'NULL'}`);
      if (getFilter(field, 'unique')) {
        lineTokens.push('UNIQUE');
      }
      return lineTokens.join(' ').trim();
    });

    fieldLines.unshift(`${mysql2.escapeId('id')} INT PRIMARY KEY AUTO_INCREMENT`);

    const sql = `
CREATE TABLE ${mysql2.escapeId(name)} (
  ${fieldLines.join(',\n  ')}
)
    `.trim();

    await this.rawQuery(sql);
  }

  async undefine ({ name }) {
    await this.rawQuery(`DROP TABLE ${mysql2.escapeId(name)}`);
  }
}

module.exports = Mysql;

function getFilter (field, name) {
  return field.rawFilters.find(f => f[0] === name);
}
