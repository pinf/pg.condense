

exports.for = function (API) {

	const SM_CONTRACT = require("sm.contract");

	var exports = {};

	function findGitRoot (path, callback) {
		if (API.FS.existsSync(API.PATH.join(path, ".git"))) {
			return callback(null, path);
		}
		var newPath = API.PATH.dirname(path);
		if (newPath === path) {
			return callback(new Error("No git root found!"));
		}
		return findGitRoot(newPath, callback);
	}

	exports.resolve = function (resolver, config, previousResolvedConfig) {

		return resolver({}).then(function (resolvedConfig) {

// TODO: Only do condensation if we have a reason to do so (i.e. something has changed).
resolvedConfig.t = Date.now();

			return resolvedConfig;
		});
	}

	exports.turn = function (resolvedConfig) {

console.log("TRUN PG.CONDENSE", resolvedConfig);

		function getDescriptor () {

			return API.Q.denodeify(function (callback) {
				var path = API.getProgramDescriptorPath();
				if (!API.FS.existsSync(path)) {
					console.debug("Skip 'pg.condense' as program descriptor not found at '" + path + "'");
					return callback(null, null);
				}
				return API.loadProgramDescriptor(function (err, programDescriptor) {
					if (err) return callback(err);
					return callback(null, {
						"provenance": programDescriptor._data.$provenance || null,
						"config": programDescriptor._data.config
					});
				});
			})();
		}

		function getProvenances (provenance) {
			if (!provenance) return API.Q.resolve({});
			return API.Q.denodeify(function (callback) {
				var provenances = {};
				var waitfor = API.WAITFOR.serial(function (err) {
					if (err) return callback(err);
					return callback(null, provenances);
				});
				for (var path in provenance) {

					waitfor(path, function (path, callback) {

						return findGitRoot(path, function (err, gitRoot) {
							if (err) return callback(err);
							if (!gitRoot) {
								return callback(new Error("No git root found for: " + path));
							}

							provenances[gitRoot] = {
								descriptors: {}
							};

							if (provenances[gitRoot].descriptors[path]) {
								return callback(new Error("Descriptor '" + path + "' for provenance for git root '" + gitRoot + "' already defined!"));
							}

							provenances[gitRoot].descriptors[path] = provenance[path];

							return callback(null);
						});
					});
				}
				return waitfor();
			})();
		}

		function exportMappings (provenance, config) {
/*
			var aliasedPackages = {};
			for (var alias in mappings) {
				if (
					mappings[alias].location &&
					!/\//.test(alias)
				) {
					aliasedPackages[mappings[alias].location] = alias;
				}
			}
*/



			return getProvenances().then(function (provenances) {

				return API.Q.denodeify(function (callback) {
					
/*
						var finalMappings = {};
						for (var name in mappings) {
							finalMappings[name] = {
								"location": mappings[name].origin + "#" + mappings[name].ref
							};
							if (mappings[name].branch !== false) {
								finalMappings[name].location += "(" + mappings[name].branch + ")";
							}
							if (aliasedPackages[mappings[name].realpath]) {

								finalMappings[name].alias = aliasedPackages[mappings[name].realpath];
*/
/*
								finalMappings[aliasedPackages[mappings[name].realpath]] = {
									"depends": [
										name
									],
									"location": name.replace(/^\.\/\.\.\//, ""),
									"install": false
								};
*/
/*
							}

							if (
								(
									!resolvedConfig.declaredMappings[name] ||
									resolvedConfig.declaredMappings[name].install !== true
								) &&
								provenances.declaredMappings[name] &&
								provenances.declaredMappings[name].install === false
							) {
								finalMappings[name].install = false;
							}
						}
*/

						

//						function relativizeExtends (descriptor) {
//							var configStr = JSON.stringify(descriptor);
//							configStr = configStr.replace(new RegExp(API.ESCAPE_REGEXP_COMPONENT(API.PATH.dirname(API.getRootPath())), "g"), "{{env.PGS_WORKSPACE_ROOT}}");
//							return JSON.parse(configStr);
//						}

						function relativize (descriptor) {
							var configStr = JSON.stringify(descriptor);
							configStr = configStr.replace(new RegExp(API.ESCAPE_REGEXP_COMPONENT(API.PATH.join(API.PATH.dirname(API.getRootPath()), ".deps")), "g"), "{{env.PGS_PACKAGES_DIRPATH}}");
							configStr = configStr.replace(new RegExp(API.ESCAPE_REGEXP_COMPONENT(API.PATH.dirname(API.getRootPath())), "g"), "{{env.PGS_WORKSPACE_ROOT}}");
							configStr = configStr.replace(new RegExp(API.ESCAPE_REGEXP_COMPONENT(process.env.PIO_PROFILE_KEY), "g"), "{{env.PIO_PROFILE_KEY}}");
							configStr = configStr.replace(new RegExp(API.ESCAPE_REGEXP_COMPONENT(process.env.PIO_PROFILE_PATH), "g"), "{{env.PIO_PROFILE_PATH}}");
							return JSON.parse(configStr);
						}

//						descriptor["@extends"] = relativizeExtends(descriptor["@extends"]);
						descriptor = relativize(descriptor);


						if (API.FS.existsSync(resolvedConfig.export.catalog)) {
							descriptor = API.DEEPMERGE(
								JSON.parse(API.FS.readFileSync(resolvedConfig.export.catalog, "utf8")),
								descriptor
							);
						}

console.log("CATALOG", resolvedConfig.export.catalog);
process.exit(1);

						return API.FS.outputFile(
							resolvedConfig.export.catalog,
							JSON.stringify(descriptor, null, 4),
							"utf8",
							callback
						);

				})();
			});
		}

		function getMappingsForPaths (paths) {
			var basePath = API.PATH.join(API.getRootPath(), "..");
			return API.Q.when(SM_CONTRACT.api(module).GetGitStatusForPaths(
				basePath,
				paths
			)).then(function (mappings) {
				// We remove our own repository from the list if found.
				if (mappings[""]) {
					delete mappings[""];
				}
				return mappings;
			});
		}

		function deriveDescriptor (config, provenances, mappings) {
			var descriptor = {
				// TODO: Re-write extends to point to published assets/cats as we don't want to include
				//       the whole system repo we are extending in our target system.
				"@extends": {},
				"config": config,
				// finalMappings
				"@github.com~sourcemint~sm.expand~0/map": {
					"sources": {
					},
					"mappings": {
					}
				}
			};

/*

			{
			    "@github.com~sourcemint~sm.expand~0/map": {
			        "sources": {
			            "github.com~bash-origin~bash.origin.pinf~0": {
			                "master": {
			                    "uri": "git://git@github.com:bash-origin/bash.origin.pinf.git#71f525d08b6804e1b7417a5cb75214035d00ef55(master)"
			                }
			            }
			        },
			        "mappings": {
			            "bash.origin": "github.com~bash-origin~bash.origin~0/master"
			        }
			    }
			}
*/
			return descriptor;
		}

		return getDescriptor().then(function (programDescriptor) {

console.log("programDescriptor", programDescriptor);

			return getProvenances(programDescriptor.provenance).then(function (provenances) {

console.log("provenances", provenances);			

				return getMappingsForPaths(Object.keys(provenances)).then(function (mappings) {

console.log("mappings", mappings);

					var condensedDescriptor = deriveDescriptor(
						programDescriptor.config,
						provenances,
						mappings
					);

console.log("condensedDescriptor", condensedDescriptor);

//process.exit(1);

				});
			});
		});
	}

	return exports;
}

