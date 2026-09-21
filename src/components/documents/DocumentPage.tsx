import React from 'react';

/*
 * Printable documents are laid out on the official HIJ letterhead templates in
 * /public/templates. Every page is exactly A4 at 96dpi (794 x 1123 px) so the
 * PDF export can map it 1:1 onto an A4 sheet.
 */

export const A4_WIDTH_PX = 794;
export const A4_HEIGHT_PX = 1123;

/** Printed area between the letterhead banner and the address footer. */
export const CONTENT_TOP_PX = 132;
export const CONTENT_BOTTOM_PX = 112;
export const CONTENT_SIDE_PX = 44;

export type DocumentTemplate =
  | '/templates/Quatation.png'
  | '/templates/Invoice.png'
  | '/templates/Halaman1.png'
  | '/templates/Halaman2.png';

interface DocumentPageProps {
  id: string;
  template: DocumentTemplate;
  /** Lay children out inside the safe area; off for absolutely placed forms. */
  padded?: boolean;
  className?: string;
  children: React.ReactNode;
}

export const DocumentPage: React.FC<DocumentPageProps> = ({
  id,
  template,
  padded = true,
  className = '',
  children
}) => (
  <div
    id={id}
    className={`relative shrink-0 overflow-hidden bg-white text-black ${className}`}
    style={{
      width: `${A4_WIDTH_PX}px`,
      height: `${A4_HEIGHT_PX}px`,
      backgroundImage: `url("${template}")`,
      backgroundSize: '100% 100%',
      backgroundRepeat: 'no-repeat',
      fontFamily: 'Arial, Helvetica, sans-serif'
    }}
  >
    {padded ? (
      <div
        className="absolute inset-0 flex flex-col"
        style={{
          paddingTop: `${CONTENT_TOP_PX}px`,
          paddingBottom: `${CONTENT_BOTTOM_PX}px`,
          paddingLeft: `${CONTENT_SIDE_PX}px`,
          paddingRight: `${CONTENT_SIDE_PX}px`
        }}
      >
        {children}
      </div>
    ) : (
      children
    )}
  </div>
);

/** Document number, printed under the banner on the right. */
export const DocumentNumber: React.FC<{ value?: string }> = ({ value }) => (
  <p className="mb-4 text-right text-[13px] font-bold">No : {value || '-'}</p>
);

/** "Hal : …" subject line. */
export const DocumentSubject: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="mb-4 text-[12px]">
    Hal : <span className="font-bold">{children}</span>
  </p>
);

interface RecipientProps {
  name?: string;
  /** City / region line printed as "di – …". */
  place?: string;
}

export const DocumentRecipient: React.FC<RecipientProps> = ({ name, place }) => (
  <div className="mb-4 text-[12px] leading-[1.6]">
    <p>Kepada Yth,</p>
    <p className="font-bold uppercase">{name || '-'}</p>
    <p>di – {place || '-'}</p>
  </div>
);

interface SignatureProps {
  /** City the document is signed in. */
  city?: string;
  date: string;
  signerName?: string;
}

/** Wet stamp and signature block, bottom right. */
export const DocumentSignature: React.FC<SignatureProps> = ({
  city = 'Depok',
  date,
  signerName = 'PT HASIL INTI JUALAN'
}) => (
  <div className="mt-auto flex justify-end">
    <div className="w-[260px] text-center text-[12px]">
      <p>
        {city}, {date}
      </p>
      <div className="relative flex h-[88px] items-center justify-center">
        <img
          src="/templates/HIJ Logo Stamp Basah.png"
          alt=""
          aria-hidden="true"
          className="absolute h-[84px] w-auto object-contain opacity-90"
        />
        <img
          src="/templates/ttd basah.png"
          alt=""
          aria-hidden="true"
          className="relative h-[70px] w-auto object-contain"
        />
      </div>
      <p className="font-bold">{signerName}</p>
    </div>
  </div>
);
