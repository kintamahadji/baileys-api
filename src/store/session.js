import baileys from "@whiskeysockets/baileys";
import { BufferJSON, initAuthCreds } from "@whiskeysockets/baileys";
import { prisma } from "../db.js";
import { logger } from "../shared.js";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library.js";

const { proto } = baileys;
const fixId = (id) => {
	return id.replace(/\//g, "__").replace(/:/g, "-");
};

/**
 *
 * @param {String} sessionId
 * @returns {Promise<{state: AuthenticationState; saveCreds: () => Promise<void>; }>}
 */
export async function useSession(sessionId) {
	const model = prisma.session;

	/**
	 *
	 * @param {any} data
	 * @param {String} id
	 */
	const write = async (data, id) => {
		try {
			data = JSON.stringify(data, BufferJSON.replacer);
			id = fixId(id);
			await model.upsert({
				select: { pkId: true },
				create: { data, id, sessionId },
				update: { data },
				where: { sessionId_id: { id, sessionId } },
			});
		} catch (e) {
			logger.error(e, "An error occured during session write");
		}
	};

	/**
	 *
	 * @param {String} id
	 * @returns
	 */
	const read = async (id) => {
		try {
			const result = await model.findUnique({
				select: { data: true },
				where: { sessionId_id: { id: fixId(id), sessionId } },
			});

			if (!result) {
				logger.info({ id }, "Trying to read non existent session data");
				return null;
			}

			return JSON.parse(result.data, BufferJSON.reviver);
		} catch (e) {
			if (e instanceof PrismaClientKnownRequestError && e.code === "P2025") {
				logger.info({ id }, "Trying to read non existent session data");
			} else {
				logger.error(e, "An error occured during session read");
			}

			return null;
		}
	};

	/**
	 *
	 * @param {String} id
	 * @returns
	 */
	const del = async (id) => {
		try {
			await model.delete({
				select: { pkId: true },
				where: { sessionId_id: { id: fixId(id), sessionId } },
			});
		} catch (e) {
			logger.error(e, "An error occured during session delete");
		}
	};

	const creds = (await read("creds")) || initAuthCreds();

	return {
		state: {
			creds,
			keys: {
				/**
				 *
				 * @param {<T extends keyof import('@whiskeysockets/baileys').SignalDataTypeMap>} type
				 * @param {string[]} ids
				 * @returns {Promise<{ [id: string]: import('@whiskeysockets/baileys').SignalDataTypeMap>[T]; }>}
				 */
				async get(type, ids) {
					const data = {};
					await Promise.all(
						ids.map(async (id) => {
							let value = await read(`${type}-${id}`);
							if (type === "app-state-sync-key" && value) {
								value = proto.Message.AppStateSyncKeyData.fromObject(value);
							}

							data[id] = value;
						}),
					);
					return data;
				},
				/**
				 *
				 * @param {any} data
				 * @returns {Promise<void>}
				 */
				async set(data) {
					const tasks = [];

					for (const category in data) {
						for (const id in data[category]) {
							const value = data[category][id];
							const sId = `${category}-${id}`;
							tasks.push(value ? write(value, sId) : del(sId));
						}
					}

					await Promise.all(tasks);
				},
			},
		},
		saveCreds() {
			return write(creds, "creds");
		},
	};
}
