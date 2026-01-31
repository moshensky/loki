/* eslint-disable no-underscore-dangle */

const getStories = async (window) => {
  // In Storybook 10, use the index.json endpoint for story discovery
  const response = await window.fetch('./index.json');
  if (!response.ok) {
    throw new Error(
      `Unable to get stories. Failed to fetch index.json (${response.status}). Make sure you're using Storybook 10+.`
    );
  }

  const index = await response.json();
  const entries = index.entries || {};

  // Filter to only story entries (not docs) and exclude loki-skip tagged stories
  return Object.values(entries)
    .filter((entry) => entry.type === 'story')
    .filter((entry) => !entry.tags || !entry.tags.includes('loki-skip'))
    .map((entry) => ({
      id: entry.id,
      kind: entry.title,
      story: entry.name,
      parameters: {}, // Parameters are loaded at render time in SB10
    }));
};

module.exports = getStories;
