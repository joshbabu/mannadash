/**
 * Platform's own registration details for GST tax invoices — env-var driven, same on/off
 * philosophy as GST_ENABLED in gst-config.util.ts. Defaults are deliberately shaped to be
 * obviously fake (they break real GSTIN/PAN/CIN format by containing the literal word
 * "TEST") so they can never be mistaken for genuine registration numbers even if someone
 * screenshots or copy-pastes a generated invoice before real values are configured.
 *
 * To go live: set PLATFORM_GSTIN, PLATFORM_PAN, PLATFORM_CIN, PLATFORM_LEGAL_NAME, and
 * PLATFORM_ADDRESS as real env vars. isTestData flips to false automatically once
 * PLATFORM_GSTIN is set — the frontend uses that flag to decide whether to show the
 * "preview" watermark, so there's no separate manual step to remember.
 */
export interface PlatformTaxProfile {
  isTestData: boolean;
  legalEntityName: string;
  address: string;
  gstin: string;
  pan: string;
  cin: string;
}

export function getPlatformTaxProfile(): PlatformTaxProfile {
  const gstin = process.env.PLATFORM_GSTIN;
  return {
    isTestData: !gstin,
    legalEntityName: process.env.PLATFORM_LEGAL_NAME || 'MANNADASH TEST ENTITY (NOT REGISTERED)',
    address: process.env.PLATFORM_ADDRESS || 'TEST ADDRESS — NOT REGISTERED',
    gstin: gstin || '36TESTGSTIN0001Z5',
    pan: process.env.PLATFORM_PAN || 'TESTPAN0001T',
    cin: process.env.PLATFORM_CIN || 'TESTCIN0000000',
  };
}
