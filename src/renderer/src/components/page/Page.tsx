import type { ReactNode } from "react";
import { Character } from "../character/Character";
import { Icon } from "../Icon";

export function Page({ labelledBy, children }: { labelledBy: string; children: ReactNode }) {
  return (
    <section className="page" aria-labelledby={labelledBy}>
      <div className="page__inner">{children}</div>
    </section>
  );
}

export function PageHeader({
  id,
  title,
  description,
  action,
}: {
  id: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1 id={id} className="page-header__title">
          {title}
        </h1>
        <p className="page-header__description">{description}</p>
      </div>
      {action}
    </header>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="search-field">
      <Icon name="search" />
      <span className="sr-only">{placeholder}</span>
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        maxLength={500}
      />
    </label>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="empty-state">
      <Character state="idle" size={40} />
      <p>{children}</p>
    </div>
  );
}
