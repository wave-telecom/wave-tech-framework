import { number } from 'mathjs';

const KNOWN_METADATA_NUMBER_PROPS: string[] = [];

export const parseMetadataToArrayValues = (
    metadata?: Record<string, string[]>
): Record<string, string[] | boolean[] | number[]> => {
  if (!metadata) return {};

  const parsedMetadata: Record<string, string[] | boolean[] | number[]> = {};
  for (const property of Object.keys(metadata)) {
    const values = metadata[property];

    const boolValues = values.every((value) => ['true', 'false'].includes(value));
    if (boolValues) {
      parsedMetadata[property] = values.map((value) => JSON.parse(value));
      continue;
    }

    const numberValues = values.every((value) => Number(value));
    if (numberValues && KNOWN_METADATA_NUMBER_PROPS.includes(property)) {
      parsedMetadata[property] = values.map((value) => number(value));
      continue;
    }

    parsedMetadata[property] = values;
  }

  return parsedMetadata;
};

export const parseMetadataToRightTypes = (
    metadata?: Record<string, string>
): Record<string, string | boolean | number> => {
  if (!metadata) return {};

  const parsedMetadata: Record<string, string | boolean | number> = {};
  for (const property of Object.keys(metadata)) {
    const value = metadata[property];

    const boolValues = ['true', 'false'].includes(value);
    if (boolValues) {
      parsedMetadata[property] = JSON.parse(value);
      continue;
    }

    const numberValues = Number(value);
    if (numberValues && KNOWN_METADATA_NUMBER_PROPS.includes(property)) {
      parsedMetadata[property] = number(value);
      continue;
    }

    parsedMetadata[property] = value;
  }

  return parsedMetadata;
};

export const parseMetadataToArray = (
    metadata?: Record<string, string | number | boolean>
): { key: string; value: string | number | boolean }[] => {
  if (!metadata) return [];

  return Object.entries(metadata).map(([key, value]) => ({ key, value }));
};
