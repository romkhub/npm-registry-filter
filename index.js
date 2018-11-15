'use strict';

const _ = require('lodash');
const fs = require('fs');
const http = require('http');
const httpProxy = require('http-proxy');
const path = require('path');
const semver = require('semver');
const serverDestroy = require('server-destroy');
const url = require('url');
const util = require('util');

const OVERRIDES = {
    'lodash': '4.0.0'
};
const REGISTRY = 'https://registry.npmjs.org';
const PORT = 3000;

async function start() {
    const REGISTRY_PATHNAME = url.parse(REGISTRY).pathname;
    const proxy = httpProxy.createProxyServer({target: REGISTRY, secure: false, selfHandleResponse: true, changeOrigin: true});
    const server = http.createServer(function(req, res) {
        console.log('REQ', req.url);

        if (req.url.startsWith(REGISTRY_PATHNAME)) {
            proxy.web(req, res, {prependPath: false});
        }
        else {
            proxy.web(req, res, {prependPath: true});
        }
    });

    proxy.on('proxyRes', function (proxyRes, req, res) {
        let body = new Buffer('');

        proxyRes.on('data', function (data) {
            body = Buffer.concat([body, data]);
        });
        proxyRes.on('end', function () {
            try {
                const parsed = JSON.parse(body.toString());
                const override = OVERRIDES[parsed.name];

                parsed.versions = _.mapValues(parsed.versions,
                    versionSpec => _.omit(versionSpec, 'dist.integrity', '_shasum')
                );

                if (override) {
                    parsed.versions = _.pickBy(parsed.versions,
                        (value, key) => semver.satisfies(key, override)
                    );

                    const validVersions = _.keys(parsed.versions).sort((a,b) => semver.gt(a, b) ? -1 : 1);
                    const chosenVersion = validVersions[0];

                    parsed['dist-tags'] = _.mapValues(parsed['dist-tags'], tag => chosenVersion);
                    parsed.time = _.pickBy(parsed.time,
                        (v, k) => (k === 'modified'
                            || k === 'created'
                            || _.indexOf(validVersions, k) !== -1)
                    );
                }

                res.end(JSON.stringify(parsed));
            }
            catch (error) {
                res.end(body.toString());
            }
        });
    });

    await util.promisify(
        _.partial(server.listen.bind(server), PORT)
    )();

    serverDestroy(server);

    console.log(`http://localhost:${server.address().port}/`);

    process.on('SIGINT', async function() {
        console.log('destroying server...');
        proxy.close();
        await util.promisify(server.destroy)();
        process.exit(0);
    });
}

start();
