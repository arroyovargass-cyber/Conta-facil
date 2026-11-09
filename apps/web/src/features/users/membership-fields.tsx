import React from "react";
type Row = Record<string, any>;
export function MembershipFields({
  row,
  roles,
  departments,
}: {
  row?: Row;
  roles: Row[];
  departments: Row[];
}) {
  return (
    <>
      <label className="field">
        Rol
        <select name="role_id" required defaultValue={row?.role_ids?.[0] ?? ""}>
          <option value="" disabled>
            Selecciona un rol
          </option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Alcance
        <select name="scope" defaultValue={row?.scope ?? "departments"}>
          <option value="company">Toda la empresa</option>
          <option value="departments">Departamentos específicos</option>
        </select>
      </label>
      <label className="field">
        Departamentos autorizados
        <select
          name="department_ids"
          multiple
          defaultValue={row?.department_ids ?? []}
        >
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      {row && (
        <label className="field">
          Estado
          <select name="active" defaultValue={String(row.active)}>
            <option value="true">Activo</option>
            <option value="false">Inactivo · revocar acceso</option>
          </select>
        </label>
      )}
    </>
  );
}
