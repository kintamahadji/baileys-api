/**
 *
 * @param {Number} ms
 * @returns
 */
export function delay(ms) {
	return new Promise((resolve) => {
		return setTimeout(resolve, ms);
	});
}
