/** Shared product identity for local/server libraries and narrow layouts. */
export function ProductBrand({
  mode,
  compact = false,
}: {
  mode?: "local" | "serveur";
  compact?: boolean;
}) {
  return (
    <div className={`brand${compact ? " mobile-brand" : ""}`}>
      <img
        className="product-icon"
        src="/icon/128.png"
        alt=""
        width={36}
        height={36}
      />
      <div className="product-name">
        <span>Sillage</span>
        <span className="product-signature">
          by{" "}
          <img
            src="/brand/stoa-logo-encre.svg"
            alt="Stoa"
            width={34}
            height={11}
          />
        </span>
      </div>
      {mode && <small>{mode.toUpperCase()}</small>}
    </div>
  );
}
