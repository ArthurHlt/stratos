import { element } from 'protractor';
import { Store } from '@ngrx/store';
import { combineLatest, Observable, of as observableOf } from 'rxjs';
import { catchError, filter, first, map, switchMap, tap, mergeMap, startWith } from 'rxjs/operators';
import { EntityMonitor } from '../shared/monitors/entity-monitor';
import { PaginationMonitor } from '../shared/monitors/pagination-monitor';
import { RemoveUserFavoriteAction } from '../store/actions/user-favourites-actions/remove-user-favorite-action';
import { SaveUserFavoriteAction } from '../store/actions/user-favourites-actions/save-user-favorite-action';
import { AppState } from '../store/app-state';
import { userFavoritesPaginationKey } from '../store/effects/user-favorites-effect';
import { entityFactory, userFavoritesSchemaKey } from '../store/helpers/entity-factory';
import { isFavorite } from '../store/selectors/favorite.selectors';
import { PaginationEntityState } from '../store/types/pagination.types';
import { UserFavorite, UserFavoriteEndpoint } from '../store/types/user-favorites.types';
import { EntityService } from './entity-service';
import { getActionGeneratorFromFavoriteType } from './user-favorite-helpers';
import { EntityInfo } from '../store/types/api.types';
import { EndpointModel } from '../store/types/endpoint.types';
interface IntermediateFavoritesGroup {
  [endpointId: string]: UserFavorite[];
}

export interface IGroupedFavorites {
  endpoint: IEndpointFavoriteEntity;
  entities: IFavoriteEntity[];
}

export interface IEndpointFavoriteEntity extends IFavoriteEntity {
  entity: EndpointModel;
}

export interface IFavoriteEntity {
  type: string;
  entity: any;
}
export interface IAllFavorites {
  fetching: boolean;
  error: boolean;
  entityGroups: IGroupedFavorites[];
}

export class UserFavoriteManager {
  constructor(private store: Store<AppState>) { }

  private groupIntermediateFavorites = (favorites: UserFavorite[]): UserFavorite[][] => {
    const intermediateFavoritesGroup = favorites.reduce((intermediate: IntermediateFavoritesGroup, favorite: UserFavorite) => {
      const { endpointId } = favorite;
      if (!intermediate[endpointId]) {
        intermediate[endpointId] = [];
      }
      const isEndpoint = this.isEndpointType(favorite);
      if (isEndpoint) {
        intermediate[endpointId].unshift(favorite);
      } else {
        intermediate[endpointId].push(favorite);
      }
      return intermediate;
    }, {} as IntermediateFavoritesGroup);

    return Object.values(intermediateFavoritesGroup).reduce((favsArray, favs) => {
      favsArray.push(favs);
      return favsArray;
    }, [] as UserFavorite[][]);
  }

  private groupFavoriteEntities(intermediateEntitiesGroup: IFavoriteEntity[][]): IGroupedFavorites[] {
    return Object.values(intermediateEntitiesGroup).reduce((group: IGroupedFavorites[], userFavorites: IFavoriteEntity[]) => {
      const [
        endpoint,
        ...entities
      ] = userFavorites;
      group.push({
        endpoint,
        entities
      });
      return group;
    }, [] as IGroupedFavorites[]);
  }

  private getTypeAndID(favorite: UserFavorite) {
    if (favorite.entityId) {
      return {
        type: favorite.entityType,
        id: favorite.entityId
      };
    }
    return {
      type: favorite.endpointType,
      id: favorite.endpointId
    };
  }

  private getCurrentPagePagination(pagination: PaginationEntityState) {
    return pagination.pageRequests[pagination.currentPage];
  }

  public hydrateAllFavorites(): Observable<IAllFavorites> {
    const paginationMonitor = new PaginationMonitor<UserFavorite>(
      this.store,
      userFavoritesPaginationKey,
      entityFactory(userFavoritesSchemaKey)
    );

    const waitForFavorites$ = paginationMonitor.pagination$.pipe(
      map(this.getCurrentPagePagination),
      filter(pageRequest => !!pageRequest),
      tap(({ error }) => {
        if (error) {
          throw new Error('Could not fetch favorites');
        }
      }),
      filter(({ busy }) => busy === false),
    );

    return waitForFavorites$.pipe(
      switchMap(() => paginationMonitor.currentPage$.pipe(
        map(this.addEndpointsToHydrateList)
      )),
      map(this.groupIntermediateFavorites),
      mergeMap(list => combineLatest(
        list.map(
          favGroup => combineLatest(favGroup.map(fav => this.hydrateFavorite(fav).pipe(
            filter(entityInfo => entityInfo.entityRequestInfo.fetching === false),
            map(entityInfo => ({
              entityInfo,
              type: this.getTypeAndID(fav).type
            })))
          ))
        ))
      ),
      map((entityRequests) => ({
        error: !entityRequests.findIndex(entityRequest => {
          return entityRequest.findIndex((request) => request.entityInfo.entityRequestInfo.error === true) > -1;
        }),
        fetching: false,
        entityGroups: this.groupFavoriteEntities(entityRequests.map(entityRequest => entityRequest.map(request => ({
          type: request.type,
          entity: request.entityInfo.entity
        }))))
      })),
      catchError(() => observableOf({
        error: true,
        fetching: false,
        entityGroups: null
      })),
      startWith({
        error: false,
        fetching: true,
        entityGroups: null
      })
    );
  }

  public addEndpointsToHydrateList = (favorites: UserFavorite[]) => {
    return favorites.reduce((newFavorites: UserFavorite[], favorite) => {
      const hasEndpoint = this.hasEndpointAsFavorite(newFavorites, favorite);
      if (!hasEndpoint) {
        const endpointFavorite = new UserFavoriteEndpoint(
          favorite.endpointId
        );
        newFavorites.push(endpointFavorite);
      }
      return newFavorites;
    }, favorites);
  }

  public hasEndpointAsFavorite(allFavorites: UserFavorite[], favoriteToFindEndpoint: UserFavorite) {
    if (this.isEndpointType(favoriteToFindEndpoint)) {
      return true;
    }
    return !!allFavorites.find(favorite => this.isEndpointType(favorite) && favorite.endpointId === favoriteToFindEndpoint.endpointId);
  }

  private isEndpointType(favorite: UserFavorite) {
    return !(favorite.entityId || favorite.entityType);
  }

  public hydrateFavorite(favorite: UserFavorite): Observable<EntityInfo> {
    const { type, id } = this.getTypeAndID(favorite);
    const action = getActionGeneratorFromFavoriteType(favorite);
    if (action) {
      const entityMonitor = new EntityMonitor(this.store, id, type, entityFactory(type));

      if (favorite.endpointType === 'endpoint') {
        return combineLatest(entityMonitor.entity$, entityMonitor.entityRequest$).pipe(
          map(([entity, entityRequestInfo]) => ({ entity, entityRequestInfo }))
        );
      }

      const entityService = new EntityService(
        this.store,
        entityMonitor,
        action
      );
      return entityService.entityObs$;
    }
    return observableOf(null);
  }

  public getIsFavoriteObservable(favorite: UserFavorite) {
    return this.store.select(
      isFavorite(favorite)
    );
  }

  public toggleFavorite(favorite: UserFavorite) {
    this.getIsFavoriteObservable(favorite).pipe(
      first(),
      tap(isFav => {
        if (isFav) {
          this.store.dispatch(new RemoveUserFavoriteAction(favorite.guid));
        } else {
          this.store.dispatch(new SaveUserFavoriteAction(favorite));
        }
      })
    ).subscribe();
  }


}
