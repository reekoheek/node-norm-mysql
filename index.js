const Connection = require('node-norm/connection');
const mysql2 = require('mysql2/promise');
const debug = require('debug')('node-norm-mysql:index');
const debugQuery = require('debug')('node-norm-mysql:query');

const OPERATORS = {
  'ne': '!=',
  'eq': '=',
  'gt': '>',
  'lt': '<',
  'gte': '>=',
  'lte': '<=',
  'like': 'like',
};

class Mysql extends Connection {
  constructor (options) {
    super(options);

    let { host, user, password, database } = options;
    this.host = host;
    this.user = user;
    this.password = password;
    this.database = database;
  }

  getConnection () {
    debug('Deprecated #getConnection(), use #getRaw() instead');

    return this.getRaw();
  }

  getRaw () {
    if (!this.connPromise) {
      let { host, user, password, database } = this;
      this.connPromise = mysql2.createConnection({ host, user, password, database });
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
      throw new Error('Connection already ended');
    }

    throw err;
  }

  dbQuery (sql, params) {
    debug('Deprecated #dbQuery(), use #rawQuery() instead');

    return this.rawQuery(sql, params);
  }

  async rawQuery (sql, params) {
    if (debugQuery.enabled) {
      debugQuery('SQL %s', sql);
      debugQuery('??? %o', params);
    }
    let conn = await this.getRaw();
    let [result, fields] = await conn.execute(sql, params);
    return { result, fields };
  }

  async insert (query, callback = () => {}) {
    let fieldNames = query.schema.fields.map(field => field.name);
    if (!fieldNames.length) {
      fieldNames = query.rows.reduce((fieldNames, row) => {
        for (let f in row) {
          if (fieldNames.indexOf(f) === -1) {
            fieldNames.push(f);
          }
        }
        return fieldNames;
      }, []);
    }

    let placeholder = fieldNames.map(f => '?').join(', ');
    let sql = `INSERT INTO ${mysql2.escapeId(query.schema.name)}` +
      ` (${fieldNames.map(f => mysql2.escapeId(f)).join(', ')})` +
      ` VALUES (${placeholder})`;

    let changes = 0;
    await Promise.all(query.rows.map(async row => {
      let rowData = fieldNames.map(f => {
        let value = this.serialize(row[f]);
        return value;
      });

      let { result } = await this.rawQuery(sql, rowData);
      row.id = result.insertId;
      changes += result.affectedRows;

      callback(row);
    }));

    return changes;
  }

  async load (query, callback = () => {}) {
    let sqlArr = [ `SELECT * FROM ${mysql2.escapeId(query.schema.name)}` ];
    let [ wheres, data ] = this.getWhere(query);
    if (wheres) {
      sqlArr.push(wheres);
    }

    let orderBys = this.getOrderBy(query);
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

    let sql = sqlArr.join(' ');

    let { result } = await this.rawQuery(sql, data);
    return result.map(row => {
      callback(row);
      return row;
    });
  }

  async delete (query, callback) {
    let [ wheres, data ] = this.getWhere(query);
    let sqlArr = [`DELETE FROM ${mysql2.escapeId(query.schema.name)}`];
    if (wheres) {
      sqlArr.push(wheres);
    }

    let sql = sqlArr.join(' ');

    await this.rawQuery(sql, data);
  }

  getOrderBy (query) {
    let orderBys = [];
    for (let key in query.sorts) {
      let val = query.sorts[key];
      orderBys.push(`${mysql2.escapeId(key)} ${val > 0 ? 'ASC' : 'DESC'}`);
    }

    if (!orderBys.length) {
      return;
    }

    return `ORDER BY ${orderBys.join(', ')}`;
  }

  async update (query) {
    let keys = Object.keys(query.sets);

    let params = keys.map(k => this.serialize(query.sets[k]));
    let placeholder = keys.map(k => `${mysql2.escapeId(k)} = ?`).join(', ');

    let sqlArr = [`UPDATE ${mysql2.escapeId(query.schema.name)} SET ${placeholder}`];
    let [ wheres, data ] = this.getWhere(query);
    if (wheres) {
      sqlArr.push(wheres);
      params = params.concat(data);
    }

    let sql = sqlArr.join(' ');

    let { result } = await this.rawQuery(sql, params);

    return result.affectedRows;
  }

  getOr (query) {
    let wheres = [];
    let datas = [];
    for (let i = 0; i < query.length; i++) {
      if (Object.keys(query[i]).length > 1) {
        let { where, data } = this.getAnd(query[i]);
        wheres.push(where);
        datas = datas.concat(data);
        continue;
      }
      let key = Object.keys(query[i])[0];
      let value = Object.values(query[i])[0];
      let [ field, operator = 'eq' ] = key.split('!');
      if (operator === 'like') {
        value = '%' + value + '%';
      }
      datas.push(value);
      wheres.push(`${mysql2.escapeId(field)} ${OPERATORS[operator]} ?`);
    }
    return { where: `(${wheres.join(' OR ')})`, data: datas };
  }

  getAnd (query) {
    let wheres = [];
    let data = [];
    for (let key in query) {
      let value = query[key];

      if (key === '!or') {
        let or = this.getOr(value);
        wheres.push(or.where);
        data = data.concat(or.data);
        continue;
      }

      let [ field, operator = 'eq' ] = key.split('!');

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
    let wheres = [];
    let data = [];
    for (let key in query.criteria) {
      let value = query.criteria[key];

      if (key === '!or') {
        let or = this.getOr(value);
        wheres.push(or.where);
        data = data.concat(or.data);
        continue;
      }

      let [ field, operator = 'eq' ] = key.split('!');

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

    return [ `WHERE ${wheres.join(' AND ')}`, data ];
  }

  async _begin () {
    let conn = await this.getRaw();
    await conn.beginTransaction();
  }

  async _commit () {
    let conn = await this.getRaw();
    await conn.commit();
  }

  async _rollback () {
    let conn = await this.getRaw();
    await conn.rollback();
  }

  async count (query, useSkipAndLimit = false) {
    let sqlArr = [ `SELECT count(*) AS ${mysql2.escapeId('count')} FROM ${mysql2.escapeId(query.schema.name)}` ];
    let [ wheres, data ] = this.getWhere(query);
    if (wheres) {
      sqlArr.push(wheres);
    }

    if (useSkipAndLimit) {
      if (query.length >= 0) {
        sqlArr.push(`LIMIT ${query.length}`);

        if (query.offset > 0) {
          sqlArr.push(`OFFSET ${query.offset}`);
        }
      }
    }

    let sql = sqlArr.join(' ');

    let { result: [ row ] } = await this.rawQuery(sql, data);
    return row.count;
  }

  async end () {
    let conn = await this.getRaw();
    this.connPromise = undefined;
    await conn.end();
  }

  serialize (value) {
    if (value === null) {
      return value;
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
}

module.exports = Mysql;
