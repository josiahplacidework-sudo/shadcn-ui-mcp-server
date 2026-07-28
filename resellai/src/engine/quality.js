/**
 * Listing quality score.
 *
 * Five weighted sub-scores produce an overall figure out of 100, plus the specific fixes that
 * would raise it most. Suggestions are ordered by how much score they would recover, so the
 * first one is always the highest-leverage change.
 */

const WEIGHTS = { photos: 0.3, title: 0.2, description: 0.2, pricing: 0.2, completeness: 0.1 };

const IDEAL_PHOTOS = 6;

/**
 * @param {object} input
 * @param {object} input.listing   Output of generateListing().
 * @param {object} input.item
 * @param {number} input.price     Asking price.
 * @param {object} input.pricing   Output of priceItem().
 * @param {number} input.photoCount
 * @param {string[]} [input.includedAccessories]
 */
export function scoreListing(input) {
  const { listing, item, price, pricing, photoCount = 1, includedAccessories = [] } = input;

  const photos = scorePhotos(photoCount);
  const title = scoreTitle(listing.title, item);
  const description = scoreDescription(listing.description);
  const pricingScore = scorePricing(price, pricing);
  const completeness = scoreCompleteness(item, includedAccessories, listing);

  const parts = { photos, title, description, pricing: pricingScore, completeness };
  const overall = Math.round(
    Object.entries(parts).reduce((sum, [key, part]) => sum + part.score * WEIGHTS[key], 0),
  );

  const suggestions = Object.entries(parts)
    .filter(([, part]) => part.suggestion)
    .map(([key, part]) => ({
      area: key,
      suggestion: part.suggestion,
      gain: Math.round((100 - part.score) * WEIGHTS[key]),
    }))
    .filter((s) => s.gain > 0)
    .sort((a, b) => b.gain - a.gain);

  return { overall, parts, suggestions, grade: gradeFor(overall) };
}

function scorePhotos(photoCount) {
  const score = Math.round(Math.min(1, photoCount / IDEAL_PHOTOS) * 100);
  if (photoCount >= IDEAL_PHOTOS) return { score: 100, label: `${photoCount} photos` };
  const needed = IDEAL_PHOTOS - photoCount;
  return {
    score,
    label: `${photoCount} of ${IDEAL_PHOTOS} photos`,
    suggestion: `Add ${needed} more photo${needed === 1 ? '' : 's'} — listings with six or more sell noticeably faster.`,
  };
}

function scoreTitle(title, item) {
  let score = 100;
  const suggestions = [];

  if (title.length < 45) {
    score -= 30;
    suggestions.push('lengthen the title toward 70 characters so it matches more searches');
  }
  if (!title.toLowerCase().includes(item.brand.toLowerCase())) {
    score -= 25;
    suggestions.push('put the brand name first');
  }
  if (title.length > 80) {
    score -= 15;
    suggestions.push('trim it under 80 characters so it is not cut off');
  }

  return {
    score: Math.max(0, score),
    label: `${title.length} characters`,
    suggestion: suggestions.length ? `Improve the title: ${suggestions.join(', ')}.` : undefined,
  };
}

function scoreDescription(description) {
  const length = description.length;
  const hasMeasurements = /\d+\s*(in|inch|"|cm|lb|kg|qt|mm)/i.test(description);
  const hasSections = /CONDITION|SHIPPING|INCLUDED/.test(description);

  let score = 100;
  const suggestions = [];

  if (length < 300) {
    score -= 35;
    suggestions.push('write more detail — short descriptions read as low effort');
  }
  if (!hasMeasurements) {
    score -= 20;
    suggestions.push('add measurements or dimensions');
  }
  if (!hasSections) {
    score -= 15;
    suggestions.push('break it into condition, included, and shipping sections');
  }

  return {
    score: Math.max(0, score),
    label: `${length} characters`,
    suggestion: suggestions.length ? `Strengthen the description: ${suggestions.join(', ')}.` : undefined,
  };
}

function scorePricing(price, pricing) {
  const { quick, patient, fair } = pricing.prices ?? pricing;

  if (price >= quick && price <= patient) {
    const distance = Math.abs(price - fair) / Math.max(1, fair);
    return { score: Math.round(100 - distance * 40), label: `$${price} is inside the market band` };
  }

  if (price > patient) {
    return {
      score: 45,
      label: `$${price} is above the market band`,
      suggestion: `Priced above recent sales — dropping to $${patient} or below is what buyers are actually paying.`,
    };
  }

  return {
    score: 60,
    label: `$${price} is below the market band`,
    suggestion: `You are leaving money on the table — comparable items sell around $${fair}.`,
  };
}

function scoreCompleteness(item, includedAccessories, listing) {
  const totalAccessories = item.accessories?.length ?? 0;
  const specifics = Object.keys(listing.specifics ?? {}).length;

  let score = 100;
  const suggestions = [];

  if (totalAccessories > 0) {
    const ratio = includedAccessories.length / totalAccessories;
    if (ratio < 1) {
      score -= Math.round((1 - ratio) * 40);
      suggestions.push('confirm which accessories are included — buyers assume the worst when it is unstated');
    }
  }
  if (specifics < 5) {
    score -= 25;
    suggestions.push('fill in more item specifics so the listing surfaces in filtered searches');
  }

  return {
    score: Math.max(0, score),
    label: `${specifics} item specifics`,
    suggestion: suggestions.length ? `Complete the listing: ${suggestions.join(', ')}.` : undefined,
  };
}

function gradeFor(score) {
  if (score >= 90) return 'Excellent';
  if (score >= 75) return 'Strong';
  if (score >= 60) return 'Needs work';
  return 'Weak';
}
