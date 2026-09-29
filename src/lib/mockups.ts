import type { Design, DesignMockup, SPK } from '../types';

/*
 * A design carries any number of mockup pictures, each with a title typed on
 * the Design page ("Tampak Depan", "Detail Bordir Dada", …). Records from
 * before that list existed hold at most a front and a back picture; they are
 * read as a two-item list so every screen and the SPK sheet speak one shape.
 */

/** The blank letterhead templates are placeholders, never artwork. */
export const isArtwork = (url?: string): url is string => !!url && !String(url).startsWith('/templates/');

/** Printed when a picture was saved without a title. */
export const mockupTitle = (mockup: Pick<DesignMockup, 'title'>, index: number) =>
  mockup.title?.trim() || `Gambar ${index + 1}`;

type MockupSource = Pick<Design, 'mockups' | 'mockupFront' | 'mockupBack'>;

/** Drops empty slots and pictures that appear twice. */
function clean(list: DesignMockup[]): DesignMockup[] {
  return list.filter((mockup, index) =>
    isArtwork(mockup?.url) && list.findIndex(other => other?.url === mockup.url) === index
  );
}

export function designMockups(design?: MockupSource | null): DesignMockup[] {
  if (!design) return [];
  if (Array.isArray(design.mockups)) return clean(design.mockups);
  return clean([
    { id: 'front', title: 'Tampak Depan', url: design.mockupFront || '' },
    { id: 'back', title: 'Tampak Belakang', url: design.mockupBack || '' }
  ]);
}

/** The pictures copied onto an SPK when it was issued. */
export function spkMockups(spk?: Pick<SPK, 'mockups' | 'mockupDepan' | 'mockupBelakang'> | null): DesignMockup[] {
  if (!spk) return [];
  if (Array.isArray(spk.mockups)) return clean(spk.mockups);
  return clean([
    { id: 'front', title: 'Tampak Depan', url: spk.mockupDepan || '' },
    { id: 'back', title: 'Tampak Belakang', url: spk.mockupBelakang || '' }
  ]);
}

/*
 * The old single-picture fields stay filled from the list, so anything still
 * reading them (quotation picker, customer portal thumbnails, older exports)
 * keeps showing the first picture.
 */
export function legacyMockupFields(mockups: DesignMockup[]): Pick<Design, 'mockupFront' | 'mockupBack'> {
  return { mockupFront: mockups[0]?.url || '', mockupBack: mockups[1]?.url || '' };
}
