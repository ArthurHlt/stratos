import { Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs/Observable';
import { distinctUntilChanged, map, publishReplay, refCount, switchMap, withLatestFrom } from 'rxjs/operators';

import { CfUserService } from '../../../../shared/data-services/cf-user.service';
import {
  ManageUsersSetOrg,
  selectManageUsersCf,
  selectManageUsersPicked,
  selectManageUsersRoles,
} from '../../../../store/actions/users.actions';
import { AppState } from '../../../../store/app-state';
import { CfUser, IUserPermissionInOrg, IUserPermissionInSpace } from '../../../../store/types/user.types';
import { ActiveRouteCfOrgSpace } from '../../cf-page.types';

export interface CfSpaceRolesSelected extends IUserPermissionInSpace { }
export interface CfOrgRolesSelected extends IUserPermissionInOrg {
  spaces: { [spaceGuid: string]: CfSpaceRolesSelected };
}
export interface CfUserRolesSelected {
  [userGuid: string]: {
    [orgGuid: string]: CfOrgRolesSelected
  };
}

@Injectable()
export class CfRolesService {

  existingRoles$: Observable<CfUserRolesSelected>;
  newRoles$: Observable<CfOrgRolesSelected>;

  constructor(private store: Store<AppState>, private cfUserService: CfUserService, private activeRouteCfOrgSpace: ActiveRouteCfOrgSpace) {
    console.log('!!!!!: ', activeRouteCfOrgSpace.cfGuid);
    this.existingRoles$ = this.store.select(selectManageUsersPicked).pipe(
      withLatestFrom(this.store.select(selectManageUsersCf)),
      switchMap(([users, cfGuid]) => {
        return this.populateRoles(cfGuid, users);
      }),
      distinctUntilChanged(),
      publishReplay(1),
      refCount()
    );
    this.newRoles$ = this.store.select(selectManageUsersRoles).pipe(
      distinctUntilChanged(),
      publishReplay(1),
      refCount()
    );
  }


  setOrganization(orgGuid) {
    this.store.dispatch(new ManageUsersSetOrg(orgGuid)); // TODO: RC remove, this is stored in CfOrgRolesSelected
    // this.newRoles = this.createOrgRoles(orgGuid);
  }

  populateRoles(cfGuid: string, selectedUsers: CfUser[]): Observable<CfUserRolesSelected> {
    if (!cfGuid || !selectedUsers || selectedUsers.length === 0) {
      return Observable.of({});
    }

    const userGuids: string[] = selectedUsers.map(user => user.guid);

    // this.existingPermissions = {};
    return this.cfUserService.getUsers(cfGuid).pipe(
      // first(),
      map(users => {
        const roles = {};
        users.forEach(user => {
          if (userGuids.indexOf(user.metadata.guid) < 0) {
            return;
          }
          const mappedUser = {};
          const orgRoles = this.cfUserService.getOrgRolesFromUser(user.entity);
          const spaceRoles = this.cfUserService.getSpaceRolesFromUser(user.entity);
          orgRoles.forEach(org => {
            mappedUser[org.orgGuid] = {
              ...org,
              spaces: {}
            };
          });
          spaceRoles.forEach(space => {
            mappedUser[space.orgGuid].spaces[space.spaceGuid] = {
              ...space
            };
          });
          roles[user.metadata.guid] = mappedUser;
        });
        return roles;
      }),
    );
  }

}