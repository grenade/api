// Copyright 2017-2023 @polkadot/types authors & contributors
// SPDX-License-Identifier: Apache-2.0

/// <reference types="@polkadot/dev-test/globals.d.ts" />

import type { Registry } from '@polkadot/types-codec/types';
import type { Check } from './types.js';

import fs from 'node:fs';
import path from 'node:path';

import { hexToU8a, stringCamelCase, stringify, u8aToHex } from '@polkadot/util';

import { TypeRegistry } from '../../create/index.js';
import { unwrapStorageSi, unwrapStorageType } from '../../primitive/StorageKey.js';
import { Metadata } from '../Metadata.js';
import { getUniqTypes } from './getUniqTypes.js';

function getJsonName (version: number, type: string, sub: 'json' | 'types'): string {
  return path.join(process.cwd(), `packages/types-support/src/metadata/v${version}/${type}-${sub}.json`);
}

function writeJson (json: unknown, version: number, type: string, sub: 'json' | 'types'): void {
  fs.writeFileSync(getJsonName(version, type, sub), stringify(json, 2), { flag: 'w' });
}

function readJson <T = unknown> (version: number, type: string, sub: 'json' | 'types'): T {
  return JSON.parse(
    fs.readFileSync(getJsonName(version, type, sub), 'utf-8')
  ) as unknown as T;
}

/** @internal */
export function decodeLatestMeta (registry: Registry, type: string, version: number, { data }: Check): void {
  const metadata = new Metadata(registry, data);

  registry.setMetadata(metadata);

  it('decodes latest substrate properly', (): void => {
    const json = metadata.toJSON() as Record<string, Record<string, Record<string, string>>>;

    delete json.metadata[`v${metadata.version}`].lookup;

    expect(metadata.version).toBe(version);

    try {
      expect(json).toEqual(readJson(version, type, 'json'));
    } catch (error) {
      if (process.env.GITHUB_REPOSITORY) {
        throw error;
      }

      console.error(error);
      writeJson(json, version, type, 'json');
    }
  });

  if (version >= 14) {
    it('decodes latest types correctly', (): void => {
      const json = metadata.asLatest.lookup.types.toJSON();

      try {
        expect(json).toEqual(readJson(version, type, 'types'));
      } catch (error) {
        if (process.env.GITHUB_REPOSITORY) {
          throw error;
        }

        console.error(error);
        writeJson(json, version, type, 'types');
      }
    });
  }
}

/** @internal */
export function toLatest (registry: Registry, version: number, { data }: Check, withThrow = true): void {
  it(`converts v${version} to latest`, (): void => {
    const metadata = new Metadata(registry, data);

    registry.setMetadata(metadata);

    const latest = metadata.asLatest;

    if (metadata.version < 14) {
      getUniqTypes(registry, latest, withThrow);
    }
  });
}

/** @internal */
export function defaultValues (registry: Registry, { data, fails = [] }: Check, withThrow = true, withFallbackCheck = false): void {
  describe('storage with default values', (): void => {
    const metadata = new Metadata(registry, data);
    const { pallets } = metadata.asLatest;

    pallets.filter(({ storage }) => storage.isSome).forEach(({ name, storage }): void => {
      const sectionName = stringCamelCase(name);

      storage.unwrap().items.forEach(({ fallback, modifier, name, type }): void => {
        const inner = unwrapStorageType(registry, type, modifier.isOptional);
        const location = `${sectionName}.${stringCamelCase(name)}: ${inner}`;

        it(location, (): void => {
          expect((): void => {
            try {
              const instance = registry.createTypeUnsafe(
                registry.createLookupType(unwrapStorageSi(type)),
                [hexToU8a(fallback.toHex())],
                { isOptional: modifier.isOptional }
              );

              if (withFallbackCheck) {
                const [hexType, hexOrig] = [u8aToHex(instance.toU8a()), u8aToHex(fallback.toU8a(true))];

                if (hexType !== hexOrig) {
                  throw new Error(`Fallback does not match (${((hexOrig.length - 2) / 2) - ((hexType.length - 2) / 2)} bytes missing): ${hexType} !== ${hexOrig}`);
                }
              }
            } catch (error) {
              const message = `${location}:: ${(error as Error).message}`;

              if (withThrow && !fails.some((f) => location.includes(f))) {
                throw new Error(message);
              } else {
                console.warn(message);
              }
            }
          }).not.toThrow();
        });
      });
    });
  });
}

function serialize (registry: Registry, { data }: Check): void {
  const metadata = new Metadata(registry, data);

  it('serializes to hex in the same form as retrieved', (): void => {
    expect(metadata.toHex()).toEqual(data);
  });

  // NOTE Assuming the first passes this is actually something that doesn't test
  // anything new. If the first line in this function passed and the above values
  // are equivalent, this would be as well.
  it.skip('can construct from a re-serialized form', (): void => {
    expect(
      () => new Metadata(registry, metadata.toHex())
    ).not.toThrow();
  });

  // as used in the extension
  it('can construct from asCallsOnly.toHex()', (): void => {
    expect(
      () => new Metadata(registry, metadata.asCallsOnly.toHex())
    ).not.toThrow();
  });
}

export function testMeta (version: number, matchers: Record<string, Check>, withFallback = true): void {
  describe(`MetadataV${version}`, (): void => {
    for (const [type, matcher] of Object.entries(matchers)) {
      const registry = new TypeRegistry();

      describe(type, (): void => {
        serialize(registry, matcher);
        decodeLatestMeta(registry, type, version, matcher);
        toLatest(registry, version, matcher);
        defaultValues(registry, matcher, true, withFallback);
      });
    }
  });
}
