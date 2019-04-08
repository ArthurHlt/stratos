import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { Portal } from '@angular/cdk/portal';
import { AfterContentInit, Component, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { MatDrawer } from '@angular/material';
import { ActivatedRoute, ActivatedRouteSnapshot, NavigationEnd, Route, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { combineLatest, Observable, Subscription } from 'rxjs';
import { debounceTime, filter, startWith, withLatestFrom } from 'rxjs/operators';

import { GetCFInfo } from '../../../../../store/src/actions/cloud-foundry.actions';
import { CloseSideNav } from '../../../../../store/src/actions/dashboard-actions';
import { GetCurrentUsersRelations } from '../../../../../store/src/actions/permissions.actions';
import { GetUserFavoritesAction } from '../../../../../store/src/actions/user-favourites-actions/get-user-favorites-action';
import { AppState } from '../../../../../store/src/app-state';
import { DashboardState } from '../../../../../store/src/reducers/dashboard-reducer';
import { EndpointHealthCheck } from '../../../../endpoints-health-checks';
import { TabNavService } from '../../../../tab-nav.service';
import { EndpointsService } from '../../../core/endpoints.service';
import { PageHeaderService } from './../../../core/page-header-service/page-header.service';
import { SideNavItem } from './../side-nav/side-nav.component';


@Component({
  selector: 'app-dashboard-base',
  templateUrl: './dashboard-base.component.html',
  styleUrls: ['./dashboard-base.component.scss']
})

export class DashboardBaseComponent implements OnInit, OnDestroy, AfterContentInit {
  public activeTabLabel$: Observable<string>;
  public subNavData$: Observable<[string, Portal<any>]>;

  constructor(
    public pageHeaderService: PageHeaderService,
    private store: Store<AppState>,
    private breakpointObserver: BreakpointObserver,
    private router: Router,
    private activatedRoute: ActivatedRoute,
    private endpointsService: EndpointsService,
    public tabNavService: TabNavService
  ) {
    if (this.breakpointObserver.isMatched(Breakpoints.Handset)) {
      this.enableMobileNav();
    }
  }

  public iconMode = true;

  private openCloseSub: Subscription;
  private closeSub: Subscription;

  public fullView: boolean;

  private routeChangeSubscription: Subscription;

  private breakpointSub: Subscription;

  @ViewChild('sidenav') public sidenav: MatDrawer;

  @ViewChild('content') public content;

  sideNavTabs: SideNavItem[] = this.getNavigationRoutes();

  sideNaveMode = 'side';

  public iconModeOpen = false;
  public sideNavWidth = 54;

  dispatchRelations() {
    this.store.dispatch(new GetCurrentUsersRelations());
  }

  ngOnInit() {
    this.breakpointSub = this.breakpointObserver.observe([Breakpoints.HandsetPortrait]).pipe(
      debounceTime(250)
    ).subscribe(result => {
      if (result.matches) {
        this.enableMobileNav();
      } else {
        this.disableMobileNav();
      }
    });

    this.subNavData$ = combineLatest(
      this.tabNavService.getCurrentTabHeaderObservable().pipe(
        startWith(null)
      ),
      this.tabNavService.tabSubNav$
    );
    this.endpointsService.registerHealthCheck(
      new EndpointHealthCheck('cf', (endpoint) => this.store.dispatch(new GetCFInfo(endpoint.guid)))
    );
    this.dispatchRelations();
    this.store.dispatch(new GetUserFavoritesAction());
    const dashboardState$ = this.store.select('dashboard');
    this.fullView = this.isFullView(this.activatedRoute.snapshot);
    this.routeChangeSubscription = this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      withLatestFrom(dashboardState$)
    ).subscribe(([event, dashboard]) => {
      if (this.content) {
        // Ensure we always end up at the of the page when we navigate.
        this.content.nativeElement.scrollTop = 0;
      }
      this.fullView = this.isFullView(this.activatedRoute.snapshot);
      if (dashboard.sideNavMode === 'over' && dashboard.sidenavOpen) {
        this.sidenav.close();
      }

      this.iconModeMouse(false);
    });
  }

  ngOnDestroy() {
    this.routeChangeSubscription.unsubscribe();
    this.breakpointSub.unsubscribe();
    this.closeSub.unsubscribe();
    this.openCloseSub.unsubscribe();
  }

  isFullView(route: ActivatedRouteSnapshot): boolean {
    while (route.firstChild) {
      route = route.firstChild;
      if (route.data.uiFullView) {
        return true;
      }
    }
    return false;
  }

  ngAfterContentInit() {
    this.closeSub = this.sidenav.openedChange.pipe(filter(isOpen => !isOpen)).subscribe(() => {
      this.store.dispatch(new CloseSideNav());
    });

    const dashboardState$ = this.store.select('dashboard');
    this.openCloseSub = dashboardState$
      .subscribe((dashboard: DashboardState) => {
        dashboard.sidenavOpen ? this.sidenav.open() : this.sidenav.close();
        this.sidenav.mode = dashboard.sideNavMode;
      });

  }

  private getNavigationRoutes(): SideNavItem[] {
    let navItems = this.collectNavigationRoutes('', this.router.config);

    // Sort by name
    navItems = navItems.sort((a: SideNavItem, b: SideNavItem) => a.label.localeCompare(b.label));

    // Sort by position
    navItems = navItems.sort((a: SideNavItem, b: SideNavItem) => {
      const posA = a.position ? a.position : 99;
      const posB = b.position ? b.position : 99;
      return posA - posB;
    });

    return navItems;
  }

  private collectNavigationRoutes(path: string, routes: Route[]): SideNavItem[] {
    if (!routes) {
      return [];
    }
    return routes.reduce((nav, route) => {
      if (route.data && route.data.stratosNavigation) {
        const item: SideNavItem = {
          ...route.data.stratosNavigation,
          link: path + '/' + route.path
        };
        if (item.requiresEndpointType) {
          item.hidden = this.endpointsService.doesNotHaveConnectedEndpointType(item.requiresEndpointType);
        } else if (item.requiresPersistence) {
          item.hidden = this.endpointsService.disablePersistenceFeatures$.pipe(startWith(true));
        }
        // Backwards compatibility (text became label)
        /* tslint:disable:no-string-literal  */
        if (!item.label && !!item['text']) {
          item.label = item['text'];
        }
        /* tslint:enable:no-string-literal  */
        nav.push(item);
      }

      const navs = this.collectNavigationRoutes(route.path, route.children);
      return nav.concat(navs);
    }, []);
  }

  public iconModeMouse(expand: boolean) {
    if (this.iconMode) {
      this.sideNavWidth = expand ? 200 : 54;
      this.iconModeOpen = expand;
    }
  }

  private enableMobileNav() {
    this.sideNavWidth = 200;
    this.iconMode = false;
  }

  private disableMobileNav() {
    this.sideNavWidth = 54;
    this.iconMode = true;
    this.sidenav.close();
  }
}
