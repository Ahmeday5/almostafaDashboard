import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { API_ENDPOINTS } from '../../../core/constants/api-endpoints.const';
import {
  AppUser,
  AppUserMutationResult,
  CreateAppUserPayload,
  RoleOption,
  UpdateAppUserPayload,
} from '../models/app-user.model';
import {
  withCache,
  withCacheBypass,
  withCacheInvalidate,
  withInlineHandling,
} from '../../../core/http/http-context.tokens';
import { ROLE_LABELS_AR } from '../../../core/constants/user-roles.const';
import { UserRole } from '../../../core/models/auth.model';

const APP_USERS_CACHE_KEY = 'app-users';

const ROLES_TTL_MS = 60 * 60 * 1000; // 1 hour
const USERS_TTL_MS = 15 * 60 * 1000; // 15 minutes

@Injectable({ providedIn: 'root' })
export class AppUsersService {
  private readonly api = inject(ApiService);

  // ─────────────── reads (cached) ───────────────

  list(): Observable<AppUser[]> {
    return this.api.get<AppUser[]>(API_ENDPOINTS.appUsers.base, {
      context: withCache({ ttlMs: USERS_TTL_MS }),
    });
  }

  /** Force-refresh the list, bypassing any cached entry. */
  refreshList(): Observable<AppUser[]> {
    return this.api.get<AppUser[]>(API_ENDPOINTS.appUsers.base, {
      context: withCacheBypass(withCache({ ttlMs: USERS_TTL_MS })),
    });
  }

  getById(id: string): Observable<AppUser> {
    return this.api.get<AppUser>(API_ENDPOINTS.appUsers.byId(id), {
      context: withCache({ ttlMs: USERS_TTL_MS }),
    });
  }

  getRoles(): Observable<RoleOption[]> {
    return this.api
      .get<RoleOption[]>(API_ENDPOINTS.appUsers.roles, {
        context: withCache({ ttlMs: ROLES_TTL_MS }),
      })
      .pipe(map((rs) => this.withLocalRoles(rs)));
  }

  /** Force-refresh roles (e.g. after admin adds a new role server-side). */
  refreshRoles(): Observable<RoleOption[]> {
    return this.api
      .get<RoleOption[]>(API_ENDPOINTS.appUsers.roles, {
        context: withCacheBypass(withCache({ ttlMs: ROLES_TTL_MS })),
      })
      .pipe(map((rs) => this.withLocalRoles(rs)));
  }

  // ─────────────── mutations (invalidate) ───────────────

  create(payload: CreateAppUserPayload): Observable<AppUserMutationResult> {
    return this.api.post<AppUserMutationResult>(
      API_ENDPOINTS.appUsers.base,
      payload,
      {
        context: withInlineHandling(
          withCacheInvalidate([APP_USERS_CACHE_KEY]),
        ),
      },
    );
  }

  update(
    id: string,
    payload: UpdateAppUserPayload,
  ): Observable<AppUserMutationResult> {
    return this.api.put<AppUserMutationResult>(
      API_ENDPOINTS.appUsers.byId(id),
      payload,
      {
        context: withInlineHandling(
          withCacheInvalidate([APP_USERS_CACHE_KEY]),
        ),
      },
    );
  }

  delete(id: string): Observable<{ message: string }> {
    return this.api.delete<{ message: string }>(
      API_ENDPOINTS.appUsers.byId(id),
      {
        context: withCacheInvalidate([APP_USERS_CACHE_KEY]),
      },
    );
  }

  // ─────────────── helpers ───────────────

  /**
   * Normalises the backend role catalogue against the local
   * `ROLE_LABELS_AR`:
   *   - gives a role an Arabic label when the backend sent none, or sent the
   *     English id as its name (e.g. `SuperAdmin`);
   *   - adds any known role the backend left out (e.g. a newly added
   *     `SuperAdmin`), so it still shows in pickers and existing users
   *     with that role can be edited without losing it.
   */
  private withLocalRoles(fromApi: RoleOption[] | null | undefined): RoleOption[] {
    const list = (fromApi ?? []).map((r) => {
      const local = ROLE_LABELS_AR[r.id as UserRole];
      const name = r.nameAr?.trim();
      return local && (!name || name === r.id) ? { ...r, nameAr: local } : r;
    });
    const present = new Set(list.map((r) => r.id));
    const missing = (Object.keys(ROLE_LABELS_AR) as UserRole[])
      .filter((id) => id !== 'Client' && !present.has(id))
      .map((id) => ({ id, nameAr: ROLE_LABELS_AR[id] }));
    return [...missing, ...list];
  }

  /** Lookup an Arabic label for a role id from a cached role catalogue. */
  resolveRoleLabel(roleId: string, roles: RoleOption[]): string {
    return roles.find((r) => r.id === roleId)?.nameAr ?? roleId;
  }
}
