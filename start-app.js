var BPromise = require("bluebird");
var fs       = require("fs");
var _        = require("lodash");
var R        = require("ramda");
var request  = BPromise.promisify(require("request"));

var app = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
var DOCKER_DAEMON = "http://127.0.0.1:2375";
var containerIds;
var template = fs.readFileSync("nginx-vhost.template", "utf8");
var sslTemplate = fs.readFileSync("nginx-vhost-ssl.template", "utf8");
_.templateSettings.interpolate = /{{([\s\S]+?)}}/g;

R.reduce(function (acc, container) {

    return acc
        .then(function () {
            var getEnv = function (env) {
                return env.key + "=" + env.value;
            };
            var getVolume = function (volume) {
                var hostDir = "/volumes/" + app.name + volume.host;
                var guestDir = volume.guest;
                return hostDir + ":" + guestDir;
            };
            var getLink = function (link) {
                var target = app.name + "." + link.target;
                var alias = link.alias;
                return target + ":" + alias;
            };

            var data = {
                Env: R.map(getEnv, container.env || []),
                Image: container.image,
                HostConfig: {
                    Binds: R.map(getVolume, container.volumes || []),
                    Links: R.map(getLink, container.links || []),
                    PublishAllPorts: container.reachable
                }
            };

            return request({
                uri: DOCKER_DAEMON + "/containers/create",
                method: "POST",
                qs: {
                    name: app.name + "." + container.name
                },
                json: data
            });
        })
        .then(function (contents) {
            container.id = contents[1].Id;
            return BPromise.resolve();
        })
        .then(function () {
            return request({
                uri: DOCKER_DAEMON + "/containers/" + container.id + "/start",
                method: "POST"
            });
        })
        .then(function () {
            return request({
                uri: DOCKER_DAEMON + "/containers/" + container.id + "/json",
                method: "GET",
                json: true
            });
        })
        .then(function (contents) {
            if (container.reachable) {
                var ports = contents[1].NetworkSettings.Ports;
                var keys = Object.keys(ports);
                container.port = ports[keys[0]][0].HostPort;
                var data = {
                    domain: container.subdomain + "." + app.domain,
                    target: "http://127.0.0.1:" + container.port
                };
                var conf = _.template(
                    (container.ssl ? sslTemplate : template),
                    data
                );
                fs.writeFileSync("/etc/nginx/apps/" + data.domain, conf, "utf8");
            }
        });

}, BPromise.resolve(), app.containers);
