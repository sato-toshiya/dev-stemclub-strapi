import { type PlainObject } from '../http/payload';
import { toTrimmedString } from './string';

export const pickString = (obj: PlainObject, key: string): string => toTrimmedString(obj[key]);
