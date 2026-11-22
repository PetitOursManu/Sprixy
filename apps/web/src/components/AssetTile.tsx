import type { MouseEvent } from 'react';
import type { Asset } from '../api';
import { Icon } from './ui';

const KIND_COLOR: Record<string, string> = {
  character: 'accent', animation: 'cyan', spritesheet: 'cyan', tileset: 'green', texture: 'green', environment: 'violet', ui: 'violet', icon: 'accent',
};

export function AssetTile({ asset, selected, onClick, onToggleSelect, selectable }: {
  asset: Asset;
  selected?: boolean;
  selectable?: boolean;
  onClick?: (e: MouseEvent) => void;
  onToggleSelect?: () => void;
}) {
  return (
    <div className={`tile ${selected ? 'selected' : ''}`} onClick={onClick} title={asset.name}>
      <div className="thumb">
        <img src={asset.fileUrl} alt={asset.name} loading="lazy" draggable={false} />
      </div>
      <div className="corner">
        {selectable && (
          <span className="sel-box" onClick={(e) => { e.stopPropagation(); onToggleSelect?.(); }}>{selected ? '✓' : ''}</span>
        )}
      </div>
      <div className="corner-r">
        {asset.favorite && <span className="star">★</span>}
        {asset.frames && asset.frames.length > 1 && <span className="chip cyan"><Icon name="film" size={11} /> {asset.frames.length}</span>}
      </div>
      <div className="meta">
        <span className="name">{asset.name}</span>
        <span className="sub">
          <span className={`chip ${KIND_COLOR[asset.kind] ?? ''}`} style={{ height: 17, fontSize: 10 }}>{asset.kind}</span>
          <span>{asset.width}×{asset.height}</span>
          {!!asset.variantCount && <span>+{asset.variantCount}</span>}
        </span>
      </div>
    </div>
  );
}
