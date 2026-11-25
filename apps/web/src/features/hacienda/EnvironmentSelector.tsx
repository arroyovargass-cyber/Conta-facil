import type { HaciendaEnvironment } from "../../../../../packages/domain/src/hacienda-environment";

export function environmentLabel(environment: HaciendaEnvironment) {
  return environment === "production" ? "Producción" : "Pruebas";
}

export function EnvironmentSelector({
  environment,
  onChange,
  label,
}: {
  environment: HaciendaEnvironment;
  onChange: (environment: HaciendaEnvironment) => void;
  label: string;
}) {
  return (
    <div className="billing-toolbar" role="group" aria-label={label}>
      {(["test", "production"] as const).map((value) => (
        <button
          key={value}
          type="button"
          className={
            environment === value ? "button primary" : "button secondary"
          }
          aria-pressed={environment === value}
          onClick={() => onChange(value)}
        >
          {environmentLabel(value)}
        </button>
      ))}
    </div>
  );
}
