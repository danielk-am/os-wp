/**
 * Bridge: re-export window.wp.data as @wordpress/data.
 *   import { select, dispatch, useSelect, subscribe } from '@wordpress/data'
 */
const d = window.wp && window.wp.data;
if ( ! d ) {
  console.error( '[os] window.wp.data not available — wp-data not enqueued?' );
}

export const select       = d?.select;
export const dispatch     = d?.dispatch;
export const useSelect    = d?.useSelect;
export const useDispatch  = d?.useDispatch;
export const subscribe    = d?.subscribe;
export const createReduxStore = d?.createReduxStore;
export const register     = d?.register;
export const combineReducers = d?.combineReducers;

export default d;
