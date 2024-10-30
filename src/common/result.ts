import * as API from '@ucanto/interface';

export * from '@ucanto/core/result';

/**
 * Returns contained `ok` if result is and throws `error` if result is not ok.
 */
export const unwrap = <T>({ ok, error }: API.Result<T, {}>): T => {
	if (error) {
		throw error;
	} else {
		return ok as T;
	}
};

/**
 * Also expose as `Result.try` which is arguably more clear.
 */
export { unwrap as try };
