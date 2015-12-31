"use strict";

var _ = require("underscore");

var wf = require("./wf");
var cjson = require("./cjson");

// not intended to be general-purpose
Object.defineProperty(Object.prototype, "deepClone", { value:
  function() {
    if (Array.isArray(this)) {
      var arr = [];
      this.forEach(x => arr.push(x ? x.deepClone() : x));
      return arr;
    } else if (typeof this === "object") {
      var obj = Object.create(this.__proto__);
      Object.keys(this).forEach(k => { obj[k] = this[k] ? this[k].deepClone() : this[k] });
      return obj;
    } else
      return this;
  }
});


class Table {
  constructor(name, description, owner, columns) {
    this.name = name;
    this.description = description;
    this.owner = owner;
    this.columns = columns;
    this.perms = allowAll(name, columns);
    this.cells = [];
  }
  addRow(user, i) {
    if (i === undefined)
      i = this.cells.length;
    if (i < 0 || i > this.cells.length)
      throw "Invalid index";
    var newRow = this.perms.init.deepClone();
    newRow._owner = user;
    this.cells.splice(i, 0, newRow); // TODO: deep cloning?
  }
  delRow(i) {
    if (i < 0 || i >= this.cells.length)
      throw "Invalid index";
    this.cells.splice(i, 1);
  }
  static get _json() { return "InputTable"; }
  export() {
    // makes copy and removes ast stuff
    return {
      name: this.name,
      description: this.description,
      owner: this.owner,
      columns: this.columns,
      perms: _.mapObject(this.perms,
        p => _.mapObject(p,
          c => {
            var nc = c.deepClone();
            delete nc.ast;
            return nc;
          }
        )
      ),
      cells: _.mapObject(this.cells,
        r => _.mapObject(r,
          c => {
            var nc = c.deepClone();
            delete nc.ast;
            return nc;
          }
        )
      )
    };
  }
}
cjson.register(Table);
exports.Table = Table;

function allowAll(tname, columns) {
  var ret = {};
  ["read", "write", "init"].forEach(function(p) {
    ret[p] = {};
    columns.forEach(function(c) {
      ret[p][c] = allow(tname, p, c);
    });
    if (p !== "init")
      ret[p].row = allow(tname, p, "row");
  });
  ret.add = {row: allow(tname, "add", "row") };
  ret.del = {row: allow(tname, "del", "row") };
  return ret;
}

function allow(tname, type, cname) {
  return new Expr("", `${tname}.${type}.${cname}`);
}

class Expr {
  constructor(src, cell) {
    this.src = src;
    this.cell = cell;
    try {
      this.ast = wf.parseCell(src, cell);
      this.error = null;
    } catch(e) {
      this.ast = null;
      this.error = e;
    }
  }
}
cjson.register(Expr);
exports.Expr = Expr;

// var t = new Table("hi", "qqq", "me", ["a", "b"]});
// var jt = cjson.stringify(t.deepClone());
// console.log(jt);
// var rt = cjson.parse(jt);
// console.log(rt.perms);