import { useApp, updateProfile } from '../app/store.js';
import { Field } from '../components/ui.js';
import {
  accentColors,
  colorThemes,
  defaultAppearance,
  tableFinishes,
  tableLooks,
} from './appearancePresets.js';

/** One-tap table looks for the home screen; the full controls stay in Settings. */
export function QuickThemes({ onMore }: { onMore: () => void }) {
  const profile = useApp((s) => s.profile);
  return (
    <section className="quick-themes" aria-labelledby="quick-themes-title">
      <div className="quick-themes-heading">
        <div className="eyebrow" id="quick-themes-title">
          SET THE MOOD
        </div>
        <button className="text-button" onClick={onMore}>
          More styles
        </button>
      </div>
      <div className="quick-theme-list" role="group" aria-label="Table themes">
        {tableLooks.map(({ name, description, ...look }) => (
          <button
            key={name}
            className="quick-theme"
            aria-label={`${name} theme`}
            title={description}
            aria-pressed={
              profile.colorTheme === look.colorTheme &&
              profile.accentColor === look.accentColor &&
              profile.tableFinish === look.tableFinish
            }
            onClick={() => void updateProfile(look)}
          >
            <span
              className="finish-preview quick-theme-swatch"
              data-table-finish={look.tableFinish}
              data-color-theme={look.colorTheme}
              data-accent-color={look.accentColor}
              aria-hidden="true"
            >
              <i />
            </span>
            <span>{name}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function AppearanceOptions() {
  const profile = useApp((s) => s.profile);
  return (
    <section className="detail-section first appearance-options">
      <Field label="Appearance">
        <select
          value={profile.theme}
          onChange={(e) => void updateProfile({ theme: e.target.value as typeof profile.theme })}
          aria-describedby="appearance-hint"
        >
          <option value="system">Use device setting</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </Field>
      <p className="hint" id="appearance-hint">
        Every theme works in light and dark mode. Changes appear immediately and are saved for this browser.
      </p>
      <h3>Find your atmosphere</h3>
      <p className="hint">A complete look in one tap. Keep your preferred light or dark mode.</p>
      <div className="table-looks" aria-label="Coordinated table looks">
        {tableLooks.map(({ name, description, ...look }) => (
          <button
            key={name}
            className="table-look"
            aria-label={name}
            aria-pressed={
              profile.colorTheme === look.colorTheme &&
              profile.accentColor === look.accentColor &&
              profile.tableFinish === look.tableFinish
            }
            onClick={() => void updateProfile(look)}
          >
            <span
              className="finish-preview look-preview"
              data-table-finish={look.tableFinish}
              data-color-theme={look.colorTheme}
              data-accent-color={look.accentColor}
              aria-hidden="true"
            >
              {[0, 1, 2, 3].map((seat) => (
                <span key={seat}>40</span>
              ))}
            </span>
            <strong>{name}</strong>
            <small>{description}</small>
          </button>
        ))}
      </div>
      <details className="appearance-customize">
        <summary>Customize colors & finish</summary>
        <fieldset className="appearance-group">
          <legend>Color theme</legend>
          <div className="theme-options">
            {colorThemes.map((option) => (
              <label className="theme-option" key={option.id}>
                <input
                  type="radio"
                  name="color-theme"
                  aria-label={option.name}
                  aria-describedby={`theme-description-${option.id}`}
                  checked={profile.colorTheme === option.id}
                  onChange={() => void updateProfile({ colorTheme: option.id })}
                />
                <span className="theme-card">
                  <span className="theme-preview" data-color-theme={option.id} aria-hidden="true">
                    <span>40</span>
                    <span>40</span>
                    <i />
                  </span>
                  <span className="theme-card-name">
                    {option.name}
                    <span className="appearance-selected" aria-hidden="true">
                      ✓
                    </span>
                  </span>
                  <span className="theme-card-description" id={`theme-description-${option.id}`}>
                    {option.description}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="appearance-group">
          <legend>Accent color</legend>
          <div className="accent-options">
            {accentColors.map((option) => (
              <label className="accent-option" key={option.id}>
                <input
                  type="radio"
                  name="accent-color"
                  aria-label={option.name}
                  checked={profile.accentColor === option.id}
                  onChange={() => void updateProfile({ accentColor: option.id })}
                />
                <span className="accent-card">
                  <span className="accent-swatch" data-accent-color={option.id} aria-hidden="true">
                    <span className="appearance-selected">✓</span>
                  </span>
                  <span>{option.name}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="Table background">
          <select
            value={profile.tableFinish}
            onChange={(e) =>
              void updateProfile({ tableFinish: e.target.value as typeof profile.tableFinish })
            }
            aria-describedby="table-background-hint"
          >
            {tableFinishes.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </Field>
        <p className="hint" id="table-background-hint">
          Choose a finish for your table and every player panel. Your color theme and player colors shine
          through.
        </p>
        <fieldset className="appearance-group finish-group">
          <legend>Table finish previews</legend>
          <div className="finish-options">
            {tableFinishes.map((option) => (
              <label className="finish-option" key={option.id}>
                <input
                  type="radio"
                  name="table-finish"
                  aria-label={option.name}
                  aria-describedby={`finish-description-${option.id}`}
                  checked={profile.tableFinish === option.id}
                  onChange={() => void updateProfile({ tableFinish: option.id })}
                />
                <span className="finish-card">
                  <span className="finish-preview" data-table-finish={option.id} aria-hidden="true">
                    <span className="finish-preview-material">{option.material}</span>
                    <span className="finish-preview-life">40</span>
                    <span className="finish-preview-seats">
                      <i />
                      <i />
                      <i />
                      <i />
                    </span>
                  </span>
                  <span className="theme-card-name">
                    {option.name}
                    <span className="appearance-selected" aria-hidden="true">
                      ✓
                    </span>
                  </span>
                  <span className="theme-card-description" id={`finish-description-${option.id}`}>
                    {option.description}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </details>
      <button className="secondary full" onClick={() => void updateProfile(defaultAppearance)}>
        Reset appearance
      </button>
    </section>
  );
}
