import { useEffect, useState } from 'react';
import { Button } from '@cocoasurface/ui';
import { host } from '../host';
import { newFromModel, openProject } from '../io';

export function Start() {
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => void host.recent().then(setRecent), []);
  return (
    <div className="cs-start">
      <div>
        <img src="./logo.svg" alt="CocoaSurface" />
        <p className="cs-note">Paint and build materials on 3D models. Start from an FBX, OBJ, glTF or USDZ model.</p>
        <div className="cs-row">
          <Button variant="primary" onClick={() => void newFromModel()}>
            New project from a model…
          </Button>
          <Button onClick={() => void openProject()}>Open…</Button>
        </div>
        {recent.length > 0 && (
          <div className="cs-recent">
            <div className="cs-sec">Recent</div>
            {recent.map((p) => (
              <button key={p} type="button" title={p} onClick={() => void openProject(p)}>
                {p.split(/[\\/]/).pop()}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
