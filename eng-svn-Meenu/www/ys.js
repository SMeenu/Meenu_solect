/**
 * webui - Node.js service
 * @Copyright (c) 2015-2016 by Solectria, A Yaskawa Company.  All rights reserved.
 * @name ys.js
 * @version v0.1.0.1
 * @author fengjia hu
 * @module --YellowStone Web Service - a nodejs application
 * @description  TLM's web/mobile server 
 */

var WebSocketServer = require('websocket').server;
var express = require('express'),
    http = require('http'),
    https = require('https');
var bodyParser = require('body-parser'); // need npm install -g body-parser
var cookieParser = require('cookie-parser');
var passport = require('passport');
var passportLocal = require('passport-local');

var app = express();
var expressSession = require('express-session');
//var admin = express(); // not used
var fs = require('fs');
var json_request = require('request');
var path = require('path');
var os = require('os');

var log4js = require('log4js');
log4js.configure({
    appenders: [
        { type: 'console' },
        { type: 'file', filename: 'logs/node.log', "maxLogSize": 32000,
            "backups": 2, category: 'webui' }
    ]
});
//log4js.loadAppender('file');
//log4js.addAppender(log4js.appenders.file('logs/cheese.log'), 'cheese');
var logger = log4js.getLogger('webui');
//logger.setLevel('ERROR');

var rel_config = JSON.parse(fs.readFileSync('./config/release.json'));

var userdb = JSON.parse(fs.readFileSync('./config/accounts.json', 'utf8'));
var login = require('./routes/login.js')(userdb); // need extension .js, my own modules, pass userdb to the module
var power = require('./routes/power.js');

// mesh network info
var nodesInfo = [];
var numberNodes = 0;
var networkNodes = [];
var networkEdges = [];
var nodesQueryTimer;

var config = require('./lib/config');
var MODBUS_SERVICE = null;

/**
 * User Access Level Definitions
 * @module -AccessLevel
 * @param {constant} ADMIN_LEVEL defined user access level for adminstrator users
 * @param {constant} FIELD_SERVICE_LEVEL defined user access level for field service users
 * @param {constant} USER_LEVEL defined user access level for general users
 */
const ADMIN_LEVEL = 0, FIELD_SERVICE_LEVEL = 1, USER_LEVEL = 2, GUEST_LEVEL = 3;
const NETWORK_MAP_JSON = '/etc/solectria/network/network_map';
const NETWORK_JSON = '/etc/solectria/network_daemon.json';
const Nw_perf_JSON = '/var/www/Nw_perf.json'
//const NETWORK_JSON = '/var/www/config/modbus.json';
const MODBUS_CONFIG = './config/modbus.json';

//
// set language function
//
function setLang() {
    var viewsDir = "/views"; // set default views folder
    if (config.language !== undefined) {
        viewsDir += "-";  // use the language views, eg: views-en or views-es
        viewsDir += config.language;
    }

    app.set('views', path.join(__dirname, viewsDir)); // using the views from the language code
}

setLang();
app.set('view engine', 'ejs');
app.set('view options', { layout: false });

// use middleware
app.use('/public', express.static('public'));
//app.use(express.static(path.join(__dirname, '/public')));

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(cookieParser());
app.use(expressSession({secret: process.env.SESSION_SECRET || 'ssshhhhh', resave: true, saveUninitialized: false}));
app.use(passport.initialize());
app.use(passport.session());

// 
// following are passport hookups
//
passport.use(new passportLocal.Strategy(function (username, password, done) {
    if (login.authentication(username, password)) {
        logger.info('Login: ' + username);
        done(null, { id: username, name: password }); // good, return with an user object
    } else {
        logger.info('Failed Login: ' + username);
        done(null, null); // no match
    }
}));

passport.serializeUser(function (user, done) { 
    done(null, user.id, user.name); // where null is error field
});

passport.deserializeUser(function (id, done) {
    // query database to get user name or cache here
    //
    done(null, { id: id, name: id, accessLevel: login.getUserAccessLevel(id)});
});

function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        next();
    } else {
        res.redirect('/login');
        //res.status(403).end();
        //res.send(403).end();
    }
}

// end of passport hookups

var osIsLinux = false;
var myip = null;
var mymac = null;
var win_ip = '169.254.0.100'; // fallback ip for Windows
//
// get wireless network ip in windows
//
var ifaces = os.networkInterfaces();
Object.keys(ifaces).forEach(function (ifname) {
    var alias = 0;
    
    ifaces[ifname].forEach(function (iface) {
        if ('IPv4' !== iface.family || iface.internal !== false) {
            // skip over internal (i.e. 127.0.0.1) and non-ipv4 addresses
            //console.log("skip loopback and IPv6")
            return;
        }
        
        if (alias >= 1) {
            // this single interface has multiple ipv4 addresses
            console.log(ifname + ':' + alias, iface.address);
        } else {
            // this interface has only one ipv4 adress
            if (ifname == "Wireless Network Connection") {
                win_ip = iface.address;
                mymac = '00:a0:96:4e:3e:c4'; //iface.mac;
            }
            //console.log(ifname, iface.address);
        }
    });
});

//
// find out what os it is running on
//
//if (false) {
if (os.type() == "Linux") {
    osIsLinux = true;
    myip = fs.readFileSync('/etc/rc.br0.ipaddr', 'utf8');
    mymac = '00:a0:96:4e:3e:c4';
} 
else {
    // not a Linux system
    // set a fallback
    myip = win_ip; //"169.254.100.14"
}
var temp = myip.split('.');

var my_id = temp[3];

// 
// following code for multicast
//
var multicast_ip = '224.0.0.114'; // 224.0.0.0/4 to 239.255.255.255, 230.185.192.108
var MULTICAST_PORT = 8088;
var dgram = require('dgram');
var mcsocket = dgram.createSocket("udp4");
var mcInternval;

function initMulticast() {
    mcsocket.on("error", function (err) {
        console.log("server error:\n" + err.stack);
        mcsocket.close();
    });

    mcsocket.on("message", function (msg, rinfo) {
        console.log("server got: " + msg + " from " +
        rinfo.address + ":" + rinfo.port);
    });

    mcsocket.on("listening", function () {
        var address = mcsocket.address();
        console.log("server listening " +
          address.address + ":" + address.port);
    });
    mcsocket.bind(41234, function () {
        mcsocket.setBroadcast(true);
        mcsocket.setMulticastTTL(128);
        mcsocket.addMembership(multicast_ip, myip);
    });
  
    mcInternval = setInterval(broadcastNodeInfo, 60000);

    var client = dgram.createSocket('udp4');  
    // client   
    client.on('listening', function () {
        var address = client.address();
        console.log('UDP Client listening on ' + address.address + ":" + address.port);
        client.setBroadcast(true)
        client.setMulticastTTL(128);
        //client.addMembership(multicast_ip);
        client.addMembership(multicast_ip, myip);
    });
    
    client.on('message', function (message, remote) {
        //console.log('A: Epic Command Received. Preparing Relay.');
        console.log('Client: From: ' + remote.address + ':' + remote.port + ' - ' + message);
    });
    
    //client.bind(MULTICAST_PORT, myip);
    client.bind(MULTICAST_PORT);
}

function broadcastNodeInfo() {
    
    var message = new Buffer(myip);
    mcsocket.send(message, 0, message.length, MULTICAST_PORT, multicast_ip);
    console.log("Sent " + message + " to the wire...");

    //clearInterval(mcInternval);
    //mcsocket.close();
}


var tryCount = 0;

/**
 * Root Page 
 * @module /
 * @param {string} / GET method: root page
 * @summary if it is authenticated, redirect to dashboard page
 * @returns either login page or dashboard page
 */
app.get('/', function (req, res) {
    tryCount = 0;

    //if (req.isAuthenticated()) {
    //    res.redirect('/dashboard');
    //} else {
    //    res.redirect('/login');
    //}
    
    // note: primary use case is a view only network network_map
    res.redirect('/network');    
});

/**
 * Login Page
 * @module /login
 * @summary username/password
 * @returns login page
 */
app.get('/login', function (req, res) {
    if (req.isAuthenticated()) {
        tryCount = 0;
    } else {
        if (req.query.error) {
            tryCount++;
        }
    }
    res.render('login', {
        userLevel: req.isAuthenticated() ? login.getUserAccessLevel(req.user.id) : GUEST_LEVEL,
        authenticated: req.isAuthenticated(),
        user: req.user,
        error: tryCount
    });
});

/**
 * Logout request
 * @module /logout
 * @param {string} /logout end the login session
 * @returns login page
 */
app.get('/logout', function (req, res) {
    if (req.isAuthenticated()) {
    logger.info('logout: '+ req.user.id);
    req.logout();
    req.session.destroy(function (err) {
        // cannot access session here
    });
    //res.req.session.success = false;
        tryCount = 0;
    }
    res.redirect('/deviceinfo');
});

/**
 * Set language
 * @module /setlanguage
 * @param {string} language eg: 'en' - for English
 * @summary if it is authenticated, redirect to dashboard page
 * @returns the page in the language encode
 */
app.get('/setlanguage', function (req, res) {
    var code = req.query.language;
    config.language = code;
    setLang();
    
    res.render('login', {
        authenticated: req.isAuthenticated(),
        user: req.user,
        error: 0
    });
    //res.redirect('/login');
});

// login authentication using passport middleware
/**
 * Login Page
 * @module /login post
 * @param {string} username the login user id
 * @param {string} password the login user password
 * @summary if it is authenticated, go dashboard page
 * @returns {html} dashboard if success, else login error
 */
app.post('/login', passport.authenticate('local', {
    successRedirect: '/dashboard',
    failureRedirect: '/login?error=1'}),
        function (req, res) {
        req.session.success = true; //'You are successfully logged in ' + un + '!';
});

// login w/o using passport middleware
app.post('/oldlogin', function (req, res) {
    //console.log(sess.user);
    //req.secure == true // is https
    // need use connect_timeout
    // morgan
    //console.log("module: login function");
    //console.log(req.body.username);
    //console.log(req.body.password);
    var un = req.body.username;
    var pw = req.body.password;
    if (login.authentication(un, pw)) {
        req.session.success = true; //'You are successfully logged in ' + un + '!';
        res.redirect('/dashboard');
    } else {
        //res.send("login error")
        req.session.error = 'Authentication failed, please check your ' 
              + ' username and password.';
        //+ ' (use "tj" and "foobar")';
        res.req.success = false;
        res.redirect('login');
    }
});

//
// routing from a neighbouring TLM
//
app.get('/exchange', function (req, res) {
    
    // check other nodes for authentication
    // let user in
    //if (req.isAuthenticated()) {
    if (req.session.success) {
        console.log(req.session.username);
        res.req.session.success = true; //'You are successfully logged in ' + un + '!';
        res.redirect('/dashboard');
    } else {
        logger.info("exchange user: " + req.query.userid);

        var user = {
            id: req.query.userid,
            username: req.cookies.userid
            //username: "admin"
        };
        req.login(user, function (err) {
            if (err) { return next(err); }
            //copied from the docs, you might want to send the user somewhere else ;)
            //console.log('req.logIn')

            return; // res.redirect('/login');
        });
        
        res.redirect('/network');
    }
});

/**
 * Dashboard Page
 * @module /dashboard
 * @param {string} /dashboard render dashboard page
 * @summary are user access controlled page

 * @returns  dashboard page
 */
app.get('/dashboard', ensureAuthenticated, function (req, res) {
    //nodesInfo = JSON.parse(fs.readFileSync('./config/network-nodes.json', 'utf8'));
    loadNodesInfo();
    numberNodes = networkNodes.length;

    //req.cookies.user = req.user.id;
    res.cookie('userid', req.user.id, { httpOnly: true });

    res.render('dashboard', {
        userLevel: login.getUserAccessLevel(req.user.id),
        authenticated: req.isAuthenticated(),
        tlm_id: my_id,
        nodes: numberNodes, 
        dashboard: true
    });
});

/**
 * Network Page: the status of WiFi Mesh network
 * @module /network
 * @param {string} /network GET method
 * @returns the network status page
 */
//app.get('/network', ensureAuthenticated, function (req, res) {
app.get('/network', function (req, res) {
    // load nodes info before render the page
    loadNodesInfo();

    res.render('network', {
        //userLevel: login.getUserAccessLevel(req.user.id),
        userLevel: req.isAuthenticated() ? login.getUserAccessLevel(req.user.id) : GUEST_LEVEL,
        authenticated: req.isAuthenticated(),
        myprotocol: protocol, 
        myport: port, 
        nodes: nodesInfo,
        //userid:     req.user.id,
        //username:   req.user.name
    });
});

/* **************************** */
/**
 * Mesh network performance test page
 * @module /test
 * @param {string} /network GET method
 * @returns the network status page
 */
app.get('/perftest', function (req, res) {
    	console.log("entering perftest");
	res.render('test-login', {
        userLevel: req.isAuthenticated() ? login.getUserAccessLevel(req.user.id) : GUEST_LEVEL,
        authenticated: req.isAuthenticated(),
        user: req.user,
        error: tryCount
    });

});

app.get('/test1', function (req, res) {
// Executed when button for quick test is pressed
	console.log("entering test1");
	var exec = require('child_process').exec;       
        var cmd1 = 'bash perfscript2.sh 1';
	// Command to execute the shell script in mode 2
	exec(cmd1, function(error, stdout, stderr) {
          // command output is in stdout
	res.send("n_nodes"+stderr);
	// Number of nodes to be tested is returned to front-end
	});
});

app.get('/test2', function (req, res) {
// Executed when button for extensive test is pressed
	console.log("entering test2");
        var exec = require('child_process').exec;
        var cmd = 'bash perfscript2.sh 2';
	// Command to execute the shell script in mode 2
        exec(cmd, function(error, stdout, stderr) {
	res.send("n_nodes"+stderr);
        });
});

/* app.post('/progressbar', function (req, res) {
        console.log("entering progressbar");
        if (req.method == 'POST') {
        }                  
        res.render('progressbar', {
        authenticated: req.isAuthenticated(),
        user: req.user,
        error: 0
    });
}); */

/** Executed when test results are expected */
app.post('/testresults', function (req, res) {
	console.log("entering testresults");
	if (req.method == 'POST') {
	}
	res.render('perf-result', {
        userLevel: req.isAuthenticated() ? login.getUserAccessLevel(req.user.id) : GUEST_LEVEL, authenticated: req.isAuthenticated(),
        user: req.user, error: tryCount
    });   
});

/** Display results: */
app.get('/nwTest', function (req, res) {                                        
console.log("entering nwtest");
var path1 = require('path');                                                    
//var filenm = path.join(__dirname, 'status');                                  
var status_flag = 0;                                                            
var network_test;                                                               
var filename;                                                                                                                                          
                                                                                
function loaddata(){                                                           
	console.log("entering loaddata fn");
    try {                                                                       
        network_test = JSON.parse(fs.readFileSync(filename, 'utf8'));           
    } catch (err) {                                                             
        logger.error(Nw_perf_JSON + ": " + err);                                
        return;                                                                 
    }                                                                           
  var neighboursStat = network_test.network.mesh.performance;                   
    var networkStats = [];                                                      
    var samp_len = [];                                                          
    var tmp_upload = [];                                                        
                                                                                
    for (var i = 0; i <neighboursStat.length; i++) {                             
        var data = {                                                            
            "ip":neighboursStat[i].IPaddr,                                      
            "latency":neighboursStat[i].Latency,                                
            "loss" :neighboursStat[i].Loss,                                     
            "upload" :neighboursStat[i].Upload,                                 
            "download" :neighboursStat[i].Download,                   
            "via" :neighboursStat[i].Via_count
        };                                                                      
        networkStats.push(data);                                                
    }                                                 
        res.json(networkStats); // read from memory                             
};                                                                             
    if (osIsLinux) {                                                            
        filename = 'Nw_perf.json';                            
	// Name of the file where the test results are loaded                  
    } else {                                                                    
        filename = '.Nw_perf.json';                                             
    }                                                                                                                                                        
function loop(){                                                                
        fs.readFile('status',  {encoding: 'utf-8'}, function(err, data){        
        if (err) {                          
               loop();
	// Makes the function wait until the results are ready
        }                                                                       
        else {                                                                  
        loaddata();                                                             
}                                                                               
});                                                                             
};  
loop();                                                                   
});

/**
 * Power Control Page
 * @module /power
 * @param {string} /power
 * @returns power curtailment page
 */
app.get('/power', ensureAuthenticated, function (req, res) {
    //if (req.session.success) {
    res.render('power', {
        userLevel: login.getUserAccessLevel(req.user.id),
        authenticated: req.isAuthenticated(),
        pattern: null
    });
    //} else {
    //    res.send("error");
    //}
});

app.get('/flot', ensureAuthenticated, function (req, res) {
    // display flot page
    //if (req.session.success) {
    res.render('flot', {
        userLevel: login.getUserAccessLevel(req.user.id),
        authenticated: req.isAuthenticated(),
        flotjs: true
    });
    //} else {
    //    res.send("error");
    //}
});

app.get('/cpu_temp', ensureAuthenticated, function (req, res) {
    //console.log("cpu_temp");
   
    if (osIsLinux) { 
        power.run_cmd("/bin/cat", ['/sys/class/hwmon/hwmon0/device/temp1_input'], 
            function (text) {
            var temp = parseInt(text) / 1000;
            res.send(temp.toString());
        });
    } else {
        var freemem = os.freemem();
        var totalmem = os.totalmem();
        var temp;
        temp = (freemem / totalmem) * 100;
        temp = os.uptime() / 100;
        
        res.send(temp.toString());
    }
});

/**
 * 128K Hz Page: 
 * @module /fast2d
 * @param {string} /fast2d GET method
 * @returns the 
 */
app.get('/fast2d', function (req, res) {

    res.render('fast2d', {
        //userLevel: login.getUserAccessLevel(req.user.id),
        userLevel: req.isAuthenticated() ? login.getUserAccessLevel(req.user.id) : GUEST_LEVEL,
        authenticated: req.isAuthenticated(),
                //userLevel: 0,
        //userid:     req.user.id,
        //username:   req.user.name
    });
});

app.get('/ACPower', function (req, res) {
    
    res.render('ACPower', {
        userLevel: req.isAuthenticated() ? login.getUserAccessLevel(req.user.id) : GUEST_LEVEL,
        authenticated: req.isAuthenticated(),
        myprotocol: protocol, 
        myport: port, 
        //userid:     req.user.id,
        //username:   req.user.name
    });
});

/**
 * User Accounts Page
 * @module /accountmgr
 * @param {string} /accountmgr Only ADMIN_LEVEL of user can access this page
 * @returns account management page 
 */
app.get('/accountmgr', ensureAuthenticated, function (req, res) {
    if (login.getUserAccessLevel(req.user.id) <= ADMIN_LEVEL) {
        res.render('accountmgr', {
            userLevel: login.getUserAccessLevel(req.user.id),
            authenticated: req.isAuthenticated(),
        });
    } else {
        res.status(403).end();
    }
});

app.get('/addaccount', ensureAuthenticated, function (req, res) {
    if (login.getUserAccessLevel(req.user.id) <= ADMIN_LEVEL) {
        res.render('addaccount', {
            userLevel: login.getUserAccessLevel(req.user.id),
            authenticated: req.isAuthenticated(),
        });
    } else {
        res.status(403).end();
    }
});

/**
 * Get accounts info
 * @module /accountmgr/getaccounts
 * @description GET request that returns a accounts info in JSON
 * @param {string} /accountmgr/getaccounts GET method
 * @returns  accounts info in JSON format
 */
app.get('/accountmgr/getaccounts', ensureAuthenticated, function (req, res) {
    var params;
    
    //var data = JSON.parse(params);
    //res.json(data); // send as JSON object

    res.json(userdb); // using JSON file   
});

/**
 * Edit MODBUS params
 * @module /editmodbus
 * @param {string} /editmodbus render MODBUS config editor page
 * @returns  MODBUS config editor page
 */
app.get('/editmodbusconfig', ensureAuthenticated, function (req, res) {
    var params;
    if (login.getUserAccessLevel(req.user.id) <= ADMIN_LEVEL) {
        //if (osIsLinux) {
            params = fs.readFileSync(MODBUS_CONFIG, 'utf8');
        //}
        //else {
        //    params = fs.readFileSync("modbus.json", 'utf8');
        //}
        
        // display network params page
        res.render('modbus-config', {
            userLevel: login.getUserAccessLevel(req.user.id),
            authenticated: req.isAuthenticated(),
            data: params
        });
    } else {
        res.status(403).end();
    }
});

/**
 * Retrieve ./config/modbus.json object
 * @module /getmodbusparams
 * @param {string} /getmodbusparams GET method
 * @returns the MODBUS config page
 */
app.get('/getmodbusparams', ensureAuthenticated, function (req, res) {
    var params;
    //if (osIsLinux) {
        params = fs.readFileSync(MODBUS_CONFIG, 'utf8');
    //}
    //else {
    //    params = fs.readFileSync("network.json", 'utf8');
    //}
    //var data = JSON.parse(params);
    //res.json(data); // send as JSON object
    res.send(params); // send as text
});

/**
 * Save to ./config/modbus.json object
 * @module /savemodbusparams
 * @param {string} /savemodbusparams POST method 
 * @param {JSON} MODBUS config params in JSON format
 * @returns  save MODBUS config params 
 */
app.post('/savemodbusparams', ensureAuthenticated, function (req, res) {
    var params = req.body.params;
    
    fs.writeFile(MODBUS_CONFIG, params);
    
    if(MODBUS_SERVICE) MODBUS_SERVICE.kill();
    Start_MODBUS();

    res.send("done"); // This is needed, the client is waiting for this   
});


/**
 * Edit network params
 * @module /editnetworkparams
 * @param {string} /editnetworkparams render network params editor page
 * @returns  network params editor page
 */
app.get('/editnetworkparams', ensureAuthenticated, function (req, res) {
    var params;
    if (login.getUserAccessLevel(req.user.id) <= ADMIN_LEVEL) {
        if (osIsLinux) {
            params = fs.readFileSync(NETWORK_JSON, 'utf8');
        }
        else {
            params = fs.readFileSync("network.json", 'utf8');
        }

        // display network params page
        res.render('network-params', {
            userLevel: login.getUserAccessLevel(req.user.id),
            authenticated: req.isAuthenticated(),
            data: params
            });
    } else {
        res.status(403).end();
    } 
});

/**
 * Retrieve network.json object
 * @module /getnetworkparams
 * @param {string} /getnetworkparams GET method
 * @returns the network status page
 */
app.get('/getnetworkparams', ensureAuthenticated, function (req, res) {
    var params;
    if (osIsLinux) {
        params = fs.readFileSync(NETWORK_JSON, 'utf8');
    }
    else {
        params = fs.readFileSync("network.json", 'utf8');
    }
    //var data = JSON.parse(params);
    //res.json(data); // send as JSON object
    res.send(params); // send as text
});

app.get('/viewlog', ensureAuthenticated, function (req, res) {
    var params;
    if (login.getUserAccessLevel(req.user.id) <= ADMIN_LEVEL) {
        if (osIsLinux) {
            params = fs.readFileSync("logs/node.log", 'utf8');
        }
        else {
            params = fs.readFileSync("logs/node.log", 'utf8');
        }
        
        // display network params page
        res.render('viewlog', {
            userLevel: login.getUserAccessLevel(req.user.id),
            authenticated: req.isAuthenticated(),
            data: params
        });
    } else {
        res.status(403).end();
    }
});

app.get('/deviceinfo', function (req, res) {
    var params;
            
    // display network params page
    res.render('deviceinfo', {
        userLevel: req.isAuthenticated() ? login.getUserAccessLevel(req.user.id) : GUEST_LEVEL,
        authenticated: req.isAuthenticated(),
        mn: rel_config.manufacture,
        md: rel_config.model,
        opt: rel_config.options,
        ver: rel_config.version,
        sn: rel_config.serial_number
    });
 
});

/**
 * Retrieve DSP log
 * @module /getdsplog
 * @request: /getdsplog
 * @response: 
 */
app.get('/getdsplog', ensureAuthenticated, function (req, res) {
    var params;
    if (osIsLinux) {
        params = fs.readFileSync("/etc/solectria/dsp/logc1", 'utf8');
    }
    else {
        params = fs.readFileSync("dsplog", 'utf8');
    }

    res.send(params); // send as text
});

/**
 * Save to network.json object
 * @module /savenetworkparams
 * @param {string} /savenetworkparams POST method 
 * @param {JSON} network-params params in JSON format
 * @returns  save network params to the node
 */
app.post('/savenetworkparams', ensureAuthenticated, function (req, res) {
    var params = req.body.params;
    
    if (osIsLinux) {
        fs.writeFile(NETWORK_JSON, params);
    }
    else {
        fs.writeFile("network.json", params);
    }
    res.send("done"); // This is needed, the client is waiting for this   
});

//
// Handles HTTP form POST
//
app.post('/powercurtailmentform', ensureAuthenticated, function (req, res) {
    if (req.method == 'POST') 
    {
        req.on('data', function (data) {
            data = data.toString();
            console.log(data.toString());
            data = data.split('&');
            console.log(data.length);

            for (var i = 0; i < data.length; i++) {
                var _data = data[i].split("=");
                if ('pslider' == _data[0])
                {
                    var powerVar = _data[1];
                    console.log(powerVar);
                    var result = "Power curtailment: " + powerVar + "%";
                    //res.render('result', { words: result, pattern: req.body.pattern });
                    if (powerVar > 50) {
                        result = '{result:"set"}';
                    }
                    else {
                        result = '{result:"failed"}';
                    }
                    res.send(result);
                    break;
                }
            }
        });
    }
});

/**
 * POST request that Set Power Curtailment to the network
 * @module /powercurtailment
 * @request: /powercurtailment
 * @response: "done"
 */
app.post('/powercurtailment', ensureAuthenticated, function (req, res) {
    //if (req.method == 'POST') {
    //if (req.session.success) {
        var powerVar = req.body.powerVar;
        console.log("req.powerVar: " + powerVar);
        power.setPowerVar(res, powerVar, osIsLinux);
        /*
        req.on('data', function (data) {

            var obj = JSON.parse(data);
            var powerVar = obj.powerVar; // powerVar is percent of total power
            console.log("powerVar: " + powerVar);

            setPowerVar(res, powerVar)
        });
         * */
    //}
});

app.post('/getmyip', function (req, res) {
    if (req.method == 'POST') {
        console.log("getmyip called")
        res.send(getmyip())
    }
});

/**
 * POST method: add an user account
 * @module /accountmgr/addaccount
 * @param {string} id new account id
 * @param {string} passwd new account password
 * @returns an account is added to account database
 */
app.post('/accountmgr/addaccount', function (req, res) {
    if (login.getUserAccessLevel(req.user.id) > ADMIN_LEVEL) {
        res.status(403).end();
        return;
    }
    
    // make sure the account is not alreay exist
    var userExist = false;
    for (var i = 0; i < userdb.length; i++) {
        if (userdb[i].id === req.body.id) {
            userExist = true;
            break;
        }
    }
    
    if (userExist) {
        res.send('error: account already exist!');
    } else { 
        var data = { 'id' : req.body.id, 'passwd' : req.body.passwd, 'accessLevel': 2, 'locked' : false };
        userdb.push(data); // add operation
    
        fs.writeFileSync('./config/accounts.json', JSON.stringify(userdb), 'utf8');
        res.send('done');

        logger.info("Added Account: " + req.body.id);
    }
});

/**
 * POST method: change a user's password
 * @module /accountmgr/changepasswd
 * @param {string} id user id
 * @param {string} passwd new user password
 * @returns 'done' if success, else "user doesn't exist"
 */
app.post('/accountmgr/changepasswd', function (req, res) {
    
    
    if (login.getUserAccessLevel(req.user.id) > ADMIN_LEVEL) {
        res.status(403).end();
        return;
    }
    
    var userExist = false;
    for (var i = 0; i < userdb.length; i++) {
        if (userdb[i].id === req.body.id) {
            userdb[i].passwd = req.body.passwd;
            userExist = true;
            break;
        }
    }
    
    if (userExist) {
        //ntUpdatePasswd(req.body.id, req.body.passwd);

        fs.writeFileSync('./config/accounts.json', JSON.stringify(userdb), 'utf8');
        res.send('done');
        logger.info("Changed Password: " + req.body.id);

    } else {
        res.send("user doesn't exist");
    }
});

/**
 * POST method: remove an user account
 * @module /accountmgr/deleteaccount
 * @param {string} id user id
 * @returns 'done', 'error' or 403
 */
app.post('/accountmgr/deleteaccount', function (req, res) {
    if (login.getUserAccessLevel(req.user.id) > ADMIN_LEVEL) {
        res.status(403).end();
        return;
    }
    // don't delete any admin accounts
    if (login.getUserAccessLevel(req.body.id) === ADMIN_LEVEL) {
        res.send("error");
        return;
    }

    var tmpDB = [];
    var userExist = false;
    for (var i = 0; i < userdb.length; i++) {
        if (userdb[i].id === req.body.id) {
            userExist = true;
        } else {
            tmpDB.push(userdb[i]);
        }
    }
    
    userdb = tmpDB;
    fs.writeFileSync('./config/accounts.json', JSON.stringify(tmpDB), 'utf8');
    res.send('done');

    logger.info("Deleted Account: " + req.body.id);
});

app.post('/ntUpdatePasswd', function (req, res) {
    if (req.method == 'POST') {
        console.log("Post ntUpdatePasswd:" + req.body.userid + "/" + req.body.passwd);
        res.send('done');
    }
});

function getmyip()
{
    return myip;
}

// 
// whole network password update function
// NIY
//
function ntUpdatePasswd(id, pw) {
    var myJSONObject = { "userid": id, "passwd": pw };
    //var myJSONObject = 'userid=' + id + '&'+ 'passwd='+ pw ;
    
    // go through all the nodes
    var cmd = protocol + '://' + '169.254.0.10' + ':' + port + '/ntUpdatePasswd';
    json_request({
        url: cmd,
        method: "POST",
        json: true,   // <--Very important!!!
        body: myJSONObject
    }, function (error, response, body) {
        logger.info("reply ntUpdatePasswd:" + body +"/" + response);
    });
}

/**
 * GET method: network_map info
 * @module network_map
 * @param {string} /network_map.json GET method
 * @returns network map data in JSON
 */
//app.get('/network_map', ensureAuthenticated, function (req, res) {
app.get('/network_map', function (req, res) {
    loadNodesInfo();
    
    var networkMapData = { "nodes": networkNodes, "edges": networkEdges };

    res.json(networkMapData); // read from memory 
});

app.get('/networkedges', ensureAuthenticated, function (req, res) {
    //refreshNetworkEdges();
    nodesQueryTimer = setTimeout(refreshNetworkEdges, 1000);
   
    res.json(networkEdges); // read from memory 
});

// for vis network graph
// using IP as node id
function loadNodesInfo() {
    var network_map;
    var filename;

    if (osIsLinux) {
        filename = NETWORK_MAP_JSON + '.json';
    } else {
        filename = './network_map.json';
    }
   
    try {
        network_map = JSON.parse(fs.readFileSync(filename, 'utf8'));
    } catch (err) {
        logger.error(NETWORK_MAP_JSON + ": " + err);
        return;
    }

    var neighboursNodes = network_map.network.mesh.neighbors;
    
    // reset nodesInfo object
    networkNodes = [];
    networkEdges = [];
    
    // root node
    var tooltip = '<div> IP: ' + myip+ '</div>' +
        '<div>mac: ' + mymac + '</div>';
    data = {
        "id": mymac, "label": my_id, "title": tooltip, "ip": myip
    };
    networkNodes.push(data);

    for (var i = 0; i < neighboursNodes.length; i++) {
        var node_id = neighboursNodes[i].ipv4.split('.')[3];
        
        // make a node
        tooltip = '<div> IP: '+ neighboursNodes[i].ipv4 + '</div>' +
        '<div>mac: ' + neighboursNodes[i].mac + '</div>';
        var data = {
            "id": neighboursNodes[i].mac, "label": node_id, "title": tooltip, "ip": neighboursNodes[i].ipv4
            //"id": neighboursNodes[i].ipv4, "label": node_id, "title": tooltip
        };
        networkNodes.push(data);
        
        // make an edge
        //makeEdge(myip, neighboursNodes[i]);
        makeEdge(mymac, neighboursNodes[i]);
    }

    // query rest nodes
    nodesQueryTimer = setTimeout(refreshNetworkEdges, 1000);

};

function refreshNetworkEdges() {
    var network_map;
    var filename;
    var fromId = mymac;
    
    // read from JSON file
    if (osIsLinux) {
        filename = NETWORK_MAP_JSON + '.json';
    } else {
        filename = './network_map.json';
    }
    
    try {
        network_map = JSON.parse(fs.readFileSync(filename, 'utf8'));
        
        var neighboursNodes = network_map.network.mesh.neighbors;
        
        // reset nodesInfo object
        networkEdges = [];
        
        for (var i = 0; i < neighboursNodes.length; i++) {
            makeEdge(fromId, neighboursNodes[i]);
        }

    } catch (err) {
        logger.error(NETWORK_MAP_JSON + ": " + err);
        return;
    }
};

// update networkEdges with the node info
function makeEdge(fromId, node) {

    if (node.mac === node.nexthop) {
        var rssi = parseInt(node.rssi);
        var color = '#ff0040'; // red
        if (rssi > -85) {
            color = '#f4fa58'; // yellow
        }
        if (rssi > -70) {
            color = '#58fa58'; // green
        }
        //color = '#2B1B17';
        data = {
        //    "from": fromId, "to": node.ipv4, 'color': { 'color': color } , "width": 3, "title": "rssi: " + node.rssi
        "from": fromId, "to": node.mac, 'color': { 'color': color } , "width": 3, "title": "rssi: " + node.rssi
          //"from": neighboursNodes[i].mac, "to": neighboursNodes[i].nexthop, 'color': {'color': color } , "value": rssi/10, "title": "rssi: " + neighboursNodes[i].rssi
        };

        networkEdges.push(data);
    } else { // indirect nodes
        var rssi = parseInt(node.rssi);
        var color = '#ff0040'; // red
        if (rssi > -85) {
            color = '#f4fa58'; // yellow
        }
        if (rssi > -70) {
            color = '#58fa58'; // green
        }
        color = '#2B1B17';
        data = {
            "from": node.mac, "to": node.nexthop, 'color': { 'color': color }, 'dashes': true, "width": 3, "title": "rssi: " + node.rssi
          //"from": neighboursNodes[i].mac, "to": neighboursNodes[i].nexthop, 'color': {'color': color } , "value": rssi/10, "title": "rssi: " + neighboursNodes[i].rssi
        };
    }
}

app.get('/128KHzData', function (req, res) {
    
    var items = [];
    for (var i = 0; i < 16000; i++) {
        var x = i;
        items.push({ x: i*7.8, y: Math.sin(x / 4) * 5 });
    }     
    
    res.json(items); // read from memory 
});

app.get('/ACPowerData', function (req, res) {
    
    var items = [];
    for (var i = 0; i < 128; i++) {
        var x = i;
        items.push({ x: i * 7.8, y: Math.sin(x / 4) * 5 });
    }
    
    res.json(items); // read from memory 
});

app.get('/slider', ensureAuthenticated, function (req, res) {
 
    res.render('slider', {
        userLevel: login.getUserAccessLevel(req.user.id), 
        authenticated: req.isAuthenticated(),
    });

});

logger.info(myip);
//initMulticast();

// start MODBUS service
function Start_MODBUS() {
    if (osIsLinux) {
        MODBUS_SERVICE = power.run_cmd('/usr/bin/nodejs', ['/var/www/modbus.js'], function (text) {
            logger.info(text);
        });
    } else {
        MODBUS_SERVICE = power.run_cmd('node', ['modbus.js'], function (text) {
            logger.info(text);
        });
    }
}

Start_MODBUS();

//if (osIsLinux) {
//    power.run_cmd('/usr/local/sbin/blinkstrip-pct', [15], function (text) {
//        console.log(text);
//    });
//}

//power.run_cmd("hostname", [], function (text) { console.log(text) })

// for https 
var options = {
    //key: fs.readFileSync('./keys/agent-key.pem'),
    //cert: fs.readFileSync('./keys/agent-cert.pem'),
    key: fs.readFileSync('./keys/localhost.key'),
    cert: fs.readFileSync('./keys/localhost.crt'),
    requestCert: false,
    rejectUnauthorized: false
};

// set PORT=80, PORT as environmental variable
// the variables of protocol and port are used in network page to assemble the nodes' URL
//
var protocol;   
var port = process.env.PORT || config.port;
var useSSL = false || config.https;
var server;
if (useSSL) { // for https
    server = https.createServer(options, app);
    protocol = 'https:';
    server.listen(port);
}
else {
    protocol = 'http:';
    //app.listen(port);
    server = http.createServer(app);
    server.listen(port);
}

logger.info(protocol + " on port " + port)

process.on("SIGTERM", function () {
    logger.info('Exit');
    process.exit();
});

// create the websocket server
wsServer = new WebSocketServer({
    httpServer: server
});

// WebSocket server
var WebSocketClients = [];
var datahandle;
var data_counter = 0;
var client;
var clientconnection;
function routineTasks() {
    
    var items = [];
 
        var x = data_counter;
        items.push({ x: x * 7.8, y: Math.sin(x / 4) * 5 });
    var data =  '[{x: ' + x * 7.8 + ', y: ' + (Math.sin(x / 2) + Math.cos(x / 4)) * 5 + '}]';
    data_counter++;
    if (WebSocketClients.length > 0) {
        if (!WebSocketClients[0].connected) {
            //console.info('Websocket pop');
            WebSocketClients.shift();
        }
    } else {
        //console.info('Websocket reset');
      data_counter = 0;
    }

    for (var i = 0; i < WebSocketClients.length; i++) {
    
        if (WebSocketClients[i].connected) {
            WebSocketClients[i].send(data); // read from memory 
        }
    }
    //WebSocketClient.send(data); // read from memory 
}
wsServer.on('request', function (request) {
    var connection = request.accept(null, request.origin);
    WebSocketClients.push(connection);
        
    // This is the most important callback for us, we'll handle
    // all messages from users here.
    connection.on('message', function (message) {
        if (message.type === 'utf8') {
            // process WebSocket message
            // set routine tasks handler
            //data_counter = 0;
            datahandle = setInterval(routineTasks, 500);
            //logger.info('data:' + message.utf8Data);

            //client.connect('ws://10.5.2.64:80/');
        }
    });
    
    connection.on('close', function (connection) {
        // close user connection
        clearInterval(datahandle);
        routineTasks();
        //clientconnection.close();

        //logger.info('websocket closed');
    });
});


