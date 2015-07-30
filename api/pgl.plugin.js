

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

			function getMappingsForPaths (paths) {
				var basePath = API.PATH.join(API.getRootPath(), "..");
				return API.Q.when(SM_CONTRACT.api(module).GetGitStatusForPaths(
					basePath,
					paths
				)).then(function (mappings) {
					var realpathMappings = {};
					for (var relpath in mappings) {
						mappings[relpath].relpath = relpath;
						realpathMappings[mappings[relpath].realpath] = mappings[relpath];
					}

					return realpathMappings;
				});
			}

			function deriveDescriptor (config, provenances, mappings) {

	//console.log("provenances", provenances);			
	//console.log("mappings", mappings);

				var descriptor = {
					// TODO: Optionally re-write extends to point to published assets/cats as we
					//		 don't want to include the whole system repo we are extending in our target system.
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

				Object.keys(provenances).forEach(function (repositoryRealpath) {

					var provenance = provenances[repositoryRealpath];
					var mapping = mappings[repositoryRealpath];

					var m = mapping.uri.match(/^git:\/\/(git@github\.com:([^\/]+\/.+?)\.git)(#([^\()]*))?(\(([^\)]+)\))?$/);
					// TODO: Respect version.
					var mappingsId = "github.com~" + m[2].replace(/\//g, "~") + "~0";
					var ref = m[4];
					var branch = m[6] || "master";

					// Exclude our own directory which will have an empty 'relpath'.
					if (mapping.relpath) {
						var mappingsAlias = mappingsId;
						var source = {};
						source[branch] = {
							uri: mapping.uri
						};
						if (mapping.installer) {
							source[branch].installer = mapping.installer;
						}
						descriptor["@github.com~sourcemint~sm.expand~0/map"].sources[mappingsId] = source;
						// TODO: Only write mappings if necessary.
						// descriptor["@github.com~sourcemint~sm.expand~0/map"].mappings[mappingsAlias] = mappingsId;
					}

					Object.keys(provenances[repositoryRealpath].descriptors).forEach(function (descriptorRealpath) {

						var provenance = provenances[repositoryRealpath].descriptors[descriptorRealpath];

						//var extendsId = mappingsId + "/" + API.PATH.relative(repositoryRealpath, descriptorRealpath);
						var extendsId = provenance.locatorKey;

						var location = null;

						// If the location is within our repository we don't need to adjust source path.
						if (descriptorRealpath.substring(0, repositoryRealpath.length) === repositoryRealpath) {

							location = descriptorRealpath;

						} else {
							location = "{{env.PGS_PACKAGES_DIRPATH}}/" + mappingsId + "/source/installed/master/" + API.PATH.relative(repositoryRealpath, descriptorRealpath);
						}

						if (
							descriptor["@extends"][extendsId] &&
							descriptor["@extends"][extendsId].location !== location
						) {
							throw new Error("All locations for the same extends ID '" + extendsId + "' must point to the same path '" + descriptor["@extends"][extendsId].location + "'!");
						}
						descriptor["@extends"][extendsId] = {
							location: location
						};

						descriptor["@extends"][extendsId] = API.DEEPMERGE(
							descriptor["@extends"][extendsId] || {},
							provenance.config
						);
					});
				});

				return descriptor;
			}

			function exportMappings (descriptor) {

				function prepareSourcePathMappings () {
					var mappings = {};
					for (var sourceId in resolvedConfig.sources) {
						for (var branch in resolvedConfig.sources[sourceId]) {
							mappings[resolvedConfig.sources[sourceId][branch].path] = "{{env.PGS_PACKAGES_DIRPATH}}/" + sourceId + "/source/installed/" + branch;
						}
					}
					return mappings;
				}

				var sourcePathMappings = prepareSourcePathMappings();

				function relativize (descriptor) {
					// TODO: Do this much more elegantly.
					var configStr = JSON.stringify(descriptor);

					configStr = configStr.replace(new RegExp(API.ESCAPE_REGEXP_COMPONENT(API.PATH.join(API.PATH.dirname(API.getRootPath()), ".deps")), "g"), "{{env.PGS_PACKAGES_DIRPATH}}");

					for (var path in sourcePathMappings) {
						configStr = configStr.replace(new RegExp(API.ESCAPE_REGEXP_COMPONENT(path), "g"), sourcePathMappings[path]);
					}

					configStr = configStr.replace(new RegExp(API.ESCAPE_REGEXP_COMPONENT(API.PATH.dirname(API.getRootPath())), "g"), "{{env.PGS_WORKSPACE_ROOT}}");
					if (process.env.PIO_PROFILE_KEY) {
						configStr = configStr.replace(new RegExp(API.ESCAPE_REGEXP_COMPONENT(process.env.PIO_PROFILE_KEY), "g"), "{{env.PIO_PROFILE_KEY}}");
					}
					if (process.env.PIO_PROFILE_PATH) {
						configStr = configStr.replace(new RegExp(API.ESCAPE_REGEXP_COMPONENT(process.env.PIO_PROFILE_PATH), "g"), "{{env.PIO_PROFILE_PATH}}");
					}
					return JSON.parse(configStr);
				}

	//			descriptor["@extends"] = relativize(descriptor["@extends"]);
				descriptor = relativize(descriptor);

				var chainPath = API.PATH.join(API.getRootPath(), "../.chains/" + API.getBootConfigTo().replace(/\//g, "~") + ".pg.json");
				if (!API.FS.existsSync(API.PATH.dirname(chainPath))) {
					API.FS.mkdirsSync(API.PATH.dirname(chainPath));
				}

				return API.QFS.write(
					chainPath,
					JSON.stringify(descriptor, null, 4)
				);
			}

			return getDescriptor().then(function (programDescriptor) {

				return getProvenances(programDescriptor.provenance).then(function (provenances) {

					return getMappingsForPaths(Object.keys(provenances)).then(function (mappings) {

						var condensedDescriptor = deriveDescriptor(
							programDescriptor.config,
							provenances,
							mappings
						);

						return exportMappings(condensedDescriptor);
					});
				});
			}).then(function () {
				return resolvedConfig;
			});
		});
	}

	return exports;
}

