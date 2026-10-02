import { useApp, updateProfile } from '../app/store.js';
import { Field } from '../components/ui.js';
import { accentColors, colorThemes, defaultAppearance, tableFinishes } from './appearancePresets.js';

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
          onChange={(e) => void updateProfile({ tableFinish: e.target.value as typeof profile.tableFinish })}
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
      <button className="secondary full" onClick={() => void updateProfile(defaultAppearance)}>
        Reset appearance
      </button>
    </section>
  );
}
