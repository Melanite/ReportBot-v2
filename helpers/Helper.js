const request = require("request");
const SteamID = require("steamid");
const SteamUser = require("steam-user");
const unzipper = require("unzipper");
const path = require("path");
const fs = require("fs");
const GameCoordinator = require("./GameCoordinator.js");

module.exports = class Helper {
	constructor(apiKey) {
		this.apiKey = apiKey;
	}

	downloadProtobufs(dir) {
		return new Promise(async (resolve, reject) => {
			let deletes = ["Protobufs-master", "protobufs"];
			await Promise.all(deletes.map(d => {
				let p = path.join(dir, d);
				if (fs.existsSync(p)) {
					return this.deleteRecursive(p);
				} else {
					return new Promise(r => r());
				}
			}));

			let newProDir = path.join(dir, "Protobufs-master");
			let proDir = path.join(dir, "protobufs");

			// Yes I know the ones I download here are technically not the same as the ones in the submodule
			// but that doesn't really matter, I doubt Valve will do any major changes with the protobufs I use here anyways
			request({
				uri: "https://github.com/SteamDatabase/Protobufs/archive/master.zip",
				encoding: null
			}, async (err, res, body) => {
				if (err) {
					reject(err);
					return;
				}

				let zip = await unzipper.Open.buffer(body);
				await zip.extract({
					path: dir
				});

				fs.rename(newProDir, proDir, (err) => {
					if (err) {
						reject(err);
						return;
					}

					resolve();
				});
			});
		});
	}

	verifyProtobufs() {
		let user = new SteamUser();
		let gc = new GameCoordinator(user);

		try {
			return typeof gc.Protos.csgo.EGCBaseClientMsg.k_EMsgGCClientHello === "number";
		} catch (e) {
			return false;
		}
	}

	deleteRecursive(dir) {
		return new Promise((resolve, reject) => {
			fs.readdir(dir, async (err, files) => {
				if (err) {
					reject(err);
					return;
				}

				for (let file of files) {
					let filePath = path.join(dir, file);
					let stat = fs.statSync(filePath);

					if (stat.isDirectory()) {
						await this.deleteRecursive(filePath);
					} else {
						await new Promise((res, rej) => {
							fs.unlink(filePath, (err) => {
								if (err) {
									rej(err);
									return;
								}

								res();
							});
						});
					}
				}

				fs.rmdir(dir, (err) => {
					if (err) {
						reject(err);
						return;
					}

					resolve();
				});
			});
		});
	}

	GetLatestVersion() {
		return new Promise(async (resolve, reject) => {
			let json = await this.GetJSON("https://raw.githubusercontent.com/BeepIsla/csgo-commend-bot/master/package.json");

			if (!json.version) {
				reject(json);
				return;
			}

			resolve(json.version);
		});
	}

	parseSteamID(input) {
		return new Promise((resolve, reject) => {
			let parsed = input.match(/^(((http(s){0,1}:\/\/){0,1}(www\.){0,1})steamcommunity\.com\/(id|profiles)\/){0,1}(?<parsed>[A-Z0-9-_]+)(\/{0,1}.{0,})$/i);
			if (!parsed) {
				reject(new Error("Failed to parse SteamID"));
				return;
			}

			let sid = undefined;
			try {
				sid = new SteamID(parsed.groups.parsed);
				if (sid.isValid() && sid.instance === 1 && sid.type === 1 && sid.universe === 1) {
					resolve(sid);
				}
			} catch (e) { }

			// If all of this is true the above one resolved
			if (sid && sid.isValid() && sid.instance === 1 && sid.type === 1 && sid.universe === 1) {
				return;
			}

			this.vanityURL(parsed.groups.parsed).then((res) => {
				if (!res.steamid) {
					reject(new Error("Invalid Vanity URL"));
					return;
				}

				resolve(new SteamID(res.steamid));
			}).catch((err) => {
				reject(err);
			});
		});
	}

	vanityURL(url) {
		return doRequest.call(this, "ISteamUser/ResolveVanityURL", "v1", {
			vanityurl: url
		}, [
			"response"
		], null);
	}

	GetJSON(options) {
		return new Promise((resolve, reject) => {
			request(options, (err, res, body) => {
				if (err) {
					reject(err);
					return;
				}

				if (res.statusCode !== 200) {
					reject(new Error("Invalid Status Code: " + res.statusCode + " - Visit https://httpstatuses.com/" + res.statusCode));
					return;
				}

				let json = undefined;
				try {
					json = JSON.parse(body);
				} catch (e) { };

				if (!json) {
					reject(body);
					return;
				}

				resolve(json);
			});
		});
	}

	chunkArray(ary, chunkSize) {
		let tempArray = [];

		for (let index = 0; index < ary.length; index += chunkSize) {
			let myChunk = ary.slice(index, index + chunkSize);
			tempArray.push(myChunk);
		}

		return tempArray;
	}
}

function doRequest(method, version, qsParams = {}, responsePath = [], validator) {
	return new Promise(async (resolve, reject) => {
		qs = qsParams;

		if (!qs.key) {
			qs.key = this.apiKey;
		}

		request({
			uri: "https://api.steampowered.com/" + method + "/" + version + "/",
			qs: qs
		}, (err, res, body) => {
			if (err) {
				reject(err);
				return;
			}

			if (res.statusCode !== 200) {
				if (res.statusCode === 403) {
					reject({
						type: "FORBIDDEN",
						key: qs.key
					});
					return;
				}

				reject(new Error("Invalid Status Code: " + res.statusCode));
				return;
			}

			let json = undefined;
			try {
				json = JSON.parse(body);
			} catch (e) { };

			if (!json) {
				reject(body);
				return;
			}

			// Validate the response
			if (responsePath.length > 0) {
				let valid = check(json, responsePath, 0, validator);
				if (!valid) {
					reject(json);
					return;
				}

				resolve(valid);
				return;
			}

			resolve(json);
		});
	});
}

function check(json, verifyPath, i, validator) {
	if (i >= verifyPath.length) {
		if (validator && !validator(json)) {
			return false;
		}

		return json;
	}

	if (typeof json[verifyPath[i]] !== "object") {
		return false;
	}

	return check(json[verifyPath[i]], verifyPath, i + 1, validator);
}
