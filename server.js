"use strict";
var express = require("express");
var session = require('express-session');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var upload = require("multer")({ dest: 'uploads/' });
var favicon = require("serve-favicon");
var debug = require("express-debug");
var fibrous = require("fibrous");
var _ = require("underscore");
var {Magic, MAGIC_MIME_TYPE} = require('mmmagic');

var fs = require("fs");
var os = require("os");
var process = require("process");
var argParser = require('minimist');

// TODO: jison in makefile

var {WebSheet} = require("./app/websheets");
var i = require("./app/input");
var cjson = require("./app/cjson");

var argv = argParser(process.argv.slice(2), {
  default: {
    port: 8000,
    address: "localhost",
    saveFile: os.homedir() + "/.websheets",
    admin: true, // if not logged in, always logs you in as admin
    defaultPass: "pass", // change this in production
    newAccounts: true, // prevent creation of new accounts
    autoEval: true, // should viewing an output table trigger evaluation of the whole table?
    debug: false, // if true, json responses leak debug information, and only
                  // output values are censored properly, not input expressions
    verbose: true, // print evaluation info
    adminReads: false, // does canRead always return true for admin (still evaluates)
    sendMail: false, // does not attempt to use mailgun, only logs new emails
    importUsers: true, // when importing, create a user for each unknown owner row
    adminCanSwitch: true, // once you login as admin, use /user/:user/login to switch around
                          // unknown users are created automatically
  },
  boolean: ["admin", "newAccounts", "autoEval", "debug", "verbose", "adminReads", "sendMail", "importUsers", "adminCanSwitch"]
});
console.log("Listening on port", argv.port);

// TODO: sending owner in output tables should be controlled by debug or a new flag

_.mixin({
  // preserves the prototype chain
  omitClone: function(obj, ...names) {
    obj = obj.deepClone();
    _.each(names, n => { delete obj[n]; });
    return obj;
  }
});

var ws;
if (fs.existsSync(argv.saveFile))
  ws = WebSheet.load(argv.saveFile, argv);
else {
  console.log("No savefile, starting from scratch");
  ws = new WebSheet(argv);
}

var secret;
try {
  secret = fs.readFileSync(".secret", "utf8");
} catch(e) {
  console.log("You need a secret session key for production!");
  secret = "websheets";
}


var app = express();
app.use(favicon("static/favicon.ico"));
app.use(cookieParser());
app.use(session({secret, resave: false, saveUninitialized: true}));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use("/static", express.static("static"));
app.use(fibrous.middleware);

// automatic sanity checks for input values
var util = function(req, res, next) {
  var ps = req.params;
  if (ps.name)
    if (!ws.input[ps.name])
      throw `Table ${ps.name} does not exist`;
    else
      req.table = ws.input[ps.name];
  if (ps.row) {
    var num = Number(ps.row);
    if (isNaN(num)) throw "Row must be an integer";
    ps.row = num;
  }
  if (ps.row && ps.col)
    if (!req.table.cells[ps.row] || !req.table.cells[ps.row][ps.col])
      throw `Cell ${ps.name}.${ps.row}.${ps.col} does not exists`;
    else
      req.cell = req.table.cells[ps.row][ps.col];
  next();
};



app.get("/", function(req, res) {
  res.redirect("static/");
});

var isUser = function(req, res, next) {
  if (argv.admin && !req.session.user)
    req.session.user = "admin";
  if (req.session.user)
    next();
  else
    res.status(403).end("Must be logged in");
};
var isAdmin = function(req, res, next) {
  isUser(req, res, function() {
    if (req.session.user === "admin")
      next();
    else
      res.status(403).end("Must be admin");
  });
};
var isOwnerOrAdmin = function(req, res, next) {
  isUser(req, res, function() {
    if (!ws.input[req.params.name])
      res.status(403).end("Table does not exist");
    else if (req.session.user === "admin" || req.session.user === ws.input[req.params.name].owner)
      next();
    else
      res.status(403).end("Must be owner of table or admin");
  });
};

// 1. USER/AUTH
app.post("/user/login", function(req, res) {
  if (ws.authUser(req.body.user, req.body.pass)) {
    req.session.user = req.body.user;
    if (req.session.user === "admin" && argv.adminCanSwitch)
      req.session.privileged = true;
    console.log("logged in as", req.session.user);
    res.end();
  } else
    res.status(400).end("invalid username/password");
});
app.get("/user/:user/login", isUser, function(req, res) {
  if (req.session.user === "admin" && argv.adminCanSwitch)
    req.session.privileged = true;
  if (!req.session.privileged)
    res.status(400).end("Cannot switch");
  if (!ws.users[req.params.user])
    ws.users[req.params.user] = {user: req.params.user, pass: "pass"};
  req.session.user = req.params.user;
  res.end();
});
app.get("/user/whoami", isUser, function(req, res) {
  res.end(req.session.user);
});
app.post("/user/logout", isUser, function(req, res) {
  req.session.destroy();
  res.end();
});
app.post("/user/create", function(req, res) {
  if (!argv.newAccounts)
    return res.status(400).end("Account creation is disabled");
  if (ws.createUser(req.body.user, req.body.pass)) {
    console.log("created user", req.body.user);
    res.end();
  } else
    res.status(400).end("duplicate user");
});
app.post("/user/delete", isUser, function(req, res) {
  ws.deleteUser(req.session.user);
  req.session.destroy();
  res.end();
});
app.post("/user/:user/delete", isAdmin, function(req, res) {
  ws.deleteUser(req.params.user);
  res.end();
});
app.get("/user/list", isUser, function(req, res) {
  res.json(ws.listUsers());
});

// 2. ADMIN/DEBUG
app.post("/debug/eval", isUser, function(req, res) {
  var result = ws.evalString(req.session.user, req.body.src);
  result.string = result.toCensoredString(ws, req.session.user);
  res.type("json").end(cjson.stringify(result));
});
app.get("/debug/keywords", isUser, function(req, res) {
  var result = ws.listKeywords();
  res.json(result);
});
app.post("/admin/purge", isAdmin, function(req, res) {
  ws.purge();
  res.end();
});
app.post("/admin/reset", isAdmin, function(req, res) {
  clearInterval(ws.intervalID);
  ws = new WebSheet(argv);
  res.end();
});
app.post("/admin/quit", isAdmin, function(req, res) {
  ws.save(argv.saveFile);
  res.end();
  process.exit(0);
});
app.post("/admin/load", isAdmin, upload.single("load"), function(req, res) {
  try {
    clearInterval(ws.intervalID);
    ws = WebSheet.load(req.file.path, argv);
    console.log("Successfully loaded state.");
    res.end();
  } finally {
    fs.unlink(req.file.path);
  }
});
app.post("/admin/save", isAdmin, function(req, res) {
  ws.save(argv.saveFile);
  res.end();
});
app.get("/admin/download", isAdmin, function(req, res) {
  var json = cjson.stringify(_.omitClone(ws, "opts", "functions"));
  res.set('Content-Type', 'application/octet-stream');
  res.set('Content-Disposition', 'attachment;filename="ws.json"');
  res.send(json);
});

// 3. Actual Websheet API
app.get("/table/list", isUser, function(req,res) {
  res.json(ws.listTables());
});
app.post("/table/create", isUser, function(req,res) {
  if (ws.input[req.body.name])
    res.status(403).end("Table already exists");
  else {
    var columns = [];
    var meta = [];
    for (var i = 0; i < req.body.numcols; i++) {
      columns.push(req.body["col-name-" + i]);
      meta.push({
        description: req.body["col-desc-" + i],
        control: req.body["col-control-" + i],
        hidden: req.body["col-hidden-" + i] === "on"
      });
    }
    ws.createTable(req.session.user,
      req.body.name, req.body.description,
      columns, meta);
    res.end();
  }
});
app.post("/table/:name/delete", util, isOwnerOrAdmin, function(req, res) {
  delete ws.input[req.params.name];
  ws.trigger("deleteTable", req.params.name);
  res.end();
});

app.get("/table/:name/input", util, isOwnerOrAdmin, function(req, res) {
  res.type("json").end(cjson.stringify(ws.getInputTable(req.session.user, req.params.name)));
});
app.get("/table/:name/output", util, isUser, function(req, res) {
  res.type("json").end(cjson.stringify(ws.getOutputTable(req.session.user, req.params.name)));
});
app.post("/table/:name/edit", util, isUser, function(req, res) {
  var name = req.params.name;
  var {perm, column, src, row} = req.body;

  // double as both privileged and normal cell editing
  if (!perm) {
    row = Number(row);
    if (isNaN(row)) throw "NaN";
  }
  if (perm) {
    isOwnerOrAdmin(req, res, function() {
      ws.input[name].perms[perm][column] =
        new i.Expr(src, `${name}.${perm}.${column}`);
      if (perm === "read")
        ws.trigger("writePerm", name, perm, column);
      res.end();
    });
  } else if (column === "_owner") {
    isAdmin(req, res, function () {
      ws.input[name].cells[row]._owner = src;
      ws.trigger("writeOwner", name, row);
      res.end();
    });
  } else {
    ws.writeCell(req.session.user, name, row, column, src);
    res.end();
  }
});
app.post("/table/:name/addrow", util, isUser, function(req, res) {
  ws.addRow(req.session.user, req.params.name, req.body.row);
  res.end();
});
app.post("/table/:name/:row/deleterow", util, isUser, function(req, res) {
  ws.deleteRow(req.session.user, req.params.name, req.params.row);
  res.end();
});
app.post("/table/import", isUser, upload.single("xls"), fibrous.middleware, function(req, res) {
  try {
    ws.import(req.session.user, req.file.path);
    res.end();
  } finally {
    fs.unlink(req.file.path);
  }
});
app.get("/table/:name/:row/:col", util, isUser, function(req, res) {
  var {name, row, col} = req.params;
  var cell = ws.getCell(req.session.user, name, row, col);
  res.type("json").end(cjson.stringify(cell));
});
app.get("/table/:name/:row/:col/download", util, isUser, function(req, res) {
  var {name, row, col} = req.params;
  var cell = ws.getCell(req.session.user, name, row, col);
  if (cell.censored) {
    res.status(500).end("Cannot access resource");
    return;    
  }
  debugger;
  if (cell.data.type !== "Tuple" || cell.data.map.type.value !== "binary") {
    res.status(500).end("No file in cell");
    return;
  }
  var buf = new Buffer(cell.data.map.data.value, "base64");
  var m = new Magic(MAGIC_MIME_TYPE);
  var ctype = m.sync.detect(buf);
  res.set('Content-Disposition', `attachment;filename="${cell.data.map.filename.value}"`);
  res.type(ctype).end(buf);
});
app.post("/table/:name/:row/:col/upload", util, isUser, upload.single("data"), fibrous.middleware, function(req, res) {
  var b = fs.readFileSync(req.file.path);
  var b64 = b.toString("base64");
  // TODO: instead, store an array with [filename, b64file], so that you can
  // display the filename too and name the downloaded file the same.
  // use req.path.originalname
  // eventually you can store a filename in the ws and put the actual file on disk
  ws.writeCell(req.session.user, req.params.name, req.params.row, req.params.col,
    `{type: "binary", filename: "${req.file.originalname}", data: "${b64}", length: ${b.length}}`);
  res.end();
});

app.get("/script/list", util, isUser, function(req, res) {
  res.type("json").end(cjson.stringify(_.map(ws.scripts, s => _.omitClone(s, "src"))));
});
app.post("/script/create", util, isUser, function(req, res) {
  if (ws.scripts[req.body.name]) {
    res.status(500).end("Script already exists");
    return;
  }
  ws.scripts[req.body.name] = {
    author: req.session.user,
    name: req.body.name,
    description: req.body.description,
    type: req.body.type,
    setuid: req.body.setuid === "on",
    src: req.body.src
  };
  res.end();
});
app.get("/script/:fname", util, isUser, function(req, res) {
  var script = ws.scripts[req.params.fname];
  if (script)
    res.type("json").end(cjson.stringify(script));
  else
    res.status(500).end("No such script");
});
app.post("/script/:fname/edit", util, isUser, function(req, res) {
  var script = ws.scripts[req.params.fname];
  if (script.author === req.session.user) {
    script.src = req.body.src;
    res.end();
  } else {
    res.status(500).end("Only the author can edit a script");
  }
});
app.post("/script/:fname/delete", util, isUser, function(req, res) {
  var script = ws.scripts[req.params.fname];
  if (script.author === req.session.user) {
    delete ws.scripts[req.params.fname];
    res.end();
  }
  else
    res.status(500).end("Only the author can delete a script")
});


var server = app.listen(argv.port, argv.address);
