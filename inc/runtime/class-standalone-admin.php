<?php
/**
 * The admin runtime every module's app is built on.
 *
 * One copy. There were ten, kept in step by `sync-standalone-runtime.sh`,
 * because the independence contract forbade a product plugin from loading code
 * owned by another. With the plugins merged that constraint is gone, and so is
 * the sync script.
 *
 * @package OS
 */

defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/class-ai-chat-relay.php';

if ( ! class_exists( 'OS_Standalone_Admin' ) ) {
	final class OS_Standalone_Admin {
		private array $config;
		private string $file;
		private string $handle;
		private OS_Standalone_Admin_AI_Chat_Relay $ai_chat;

		private function __construct( array $config, string $file ) {
			$this->config = $config;
			$this->file   = $file;
			$this->handle = sanitize_key( $config['slug'] ) . '-ci-app';
		}

		public static function boot( array $config, string $file ): void {
			$app = new self( $config, $file );
			$app->ai_chat = OS_Standalone_Admin_AI_Chat_Relay::boot( $config );
			add_action( 'init', array( $app, 'register_dynamic_meta' ), 40 );
			if ( 'content-types' === ( $config['mode'] ?? '' ) ) {
				add_action( 'init', array( $app, 'register_content_taxonomies' ), 35 );
			}
			$menu_priority = (int) ( $config['menu_priority'] ?? ( 'calendar' === ( $config['mode'] ?? '' ) ? 39 : 40 ) );
			add_action( 'admin_menu', array( $app, 'menus' ), $menu_priority );
			add_action( 'admin_enqueue_scripts', array( $app, 'enqueue' ) );
			add_action( 'admin_print_scripts', array( $app, 'print_importmap' ), 1 );
			add_action( 'rest_api_init', array( $app, 'routes' ) );
			add_filter( 'script_loader_tag', array( $app, 'module_tag' ), 10, 3 );
		}

		public function menus(): void {
			$capability = $this->config['capability'] ?? 'edit_posts';
			$this->register_top_level_separator();
			if ( ! empty( $this->config['parent_slug'] ) ) {
				$this->register_parented_menus( $capability );
				return;
			}
			if ( $this->register_optional_grouped_parent_menus( $capability ) ) {
				return;
			}
			if ( 'calendar' === ( $this->config['mode'] ?? '' ) || ! empty( $this->config['grouped_menu_types'] ) ) {
				$this->register_grouped_menus( $capability );
				return;
			}
			if ( $this->register_calendar_child_menus( $capability ) ) {
				return;
			}
			$menu_types = $this->config['menu_types'] ?? array_keys( $this->config['types'] );
			foreach ( $menu_types as $key ) {
				$type = $this->config['types'][ $key ];
				$slug     = $this->page_slug( $key );
				$plural   = $type['plural'];
				$callback = array( $this, 'render' );
				$menu_title = $this->config['menu_title'] ?? $plural;
				add_menu_page( $menu_title, $menu_title, $capability, $slug, $callback, $type['icon'] ?? 'dashicons-index-card', $type['position'] ?? $this->config['position'] ?? null );
				$is_calendar = 'calendar' === ( $this->config['mode'] ?? '' );
				$all_label   = $is_calendar ? 'All events' : 'All ' . $plural;
				$add_label   = 'Add new ' . strtolower( $type['singular'] );
				$manage_label = $is_calendar ? 'Manage events type' : 'Manage ' . $plural;
				add_submenu_page( $slug, $all_label, $all_label, $capability, $slug, $callback );
				add_submenu_page( $slug, $add_label, $add_label, $capability, $slug . '-new', $callback );
				add_submenu_page( $slug, $manage_label, $manage_label, $capability, $slug . '-manage', $callback );
			}
		}

		private function register_optional_grouped_parent_menus( string $capability ): bool {
			$parent = (string) ( $this->config['optional_parent_slug'] ?? '' );
			if ( '' === $parent || empty( $this->config['grouped_menu_types'] ) ) {
				return false;
			}

			global $admin_page_hooks, $submenu;
			if ( empty( $admin_page_hooks[ $parent ] ) ) {
				return false;
			}

			$callback   = array( $this, 'render' );
			$menu_types = (array) $this->config['grouped_menu_types'];
			$submenu[ $parent ][] = array(
				'<span class="ci-grouped-submenu-divider" aria-hidden="true"></span>',
				$capability,
				'ci-grouped-divider-' . sanitize_key( $this->config['slug'] ),
			);
			foreach ( $menu_types as $index => $key ) {
				if ( ! isset( $this->config['types'][ $key ] ) ) {
					continue;
				}
				$type = $this->config['types'][ $key ];
				if ( $index > 0 ) {
					$submenu[ $parent ][] = array(
						'<span class="ci-grouped-submenu-divider" aria-hidden="true"></span>',
						$capability,
						'ci-grouped-divider-' . sanitize_key( $type['plural'] ),
					);
				}
				$slug     = $this->page_slug( $key );
				$plural   = strtolower( $type['plural'] );
				$singular = strtolower( $type['singular'] );
				add_submenu_page( $parent, 'All ' . $plural, 'All ' . $plural, $capability, $slug, $callback );
				add_submenu_page( $parent, 'Add new ' . $singular, 'Add new ' . $singular, $capability, $slug . '-new', $callback );
				add_submenu_page( $parent, 'Manage ' . $plural . ' type', 'Manage ' . $plural . ' type', $capability, $slug . '-manage', $callback );
			}
			foreach ( array_diff( array_keys( $this->config['types'] ), $menu_types ) as $key ) {
				$type = $this->config['types'][ $key ];
				$slug = $this->page_slug( $key );
				foreach ( array( $slug, $slug . '-new', $slug . '-manage' ) as $page_slug ) {
					add_submenu_page( $parent, $type['plural'], $type['plural'], $capability, $page_slug, $callback );
					remove_submenu_page( $parent, $page_slug );
				}
			}
			add_action( 'admin_head', array( $this, 'grouped_submenu_styles' ) );
			add_action( 'admin_footer', array( $this, 'grouped_submenu_accessibility' ) );
			return true;
		}

		private function register_top_level_separator(): void {
			$separator = $this->config['separator_before'] ?? null;
			if ( ! is_array( $separator ) || empty( $separator['position'] ) || empty( $separator['slug'] ) ) {
				return;
			}
			global $menu;
			if ( ! is_array( $menu ) ) {
				$menu = array();
			}
			$slug = sanitize_key( $separator['slug'] );
			foreach ( $menu as $item ) {
				if ( $slug === ( $item[2] ?? '' ) ) {
					return;
				}
			}
			$menu[ (string) $separator['position'] ] = array( '', 'read', $slug, '', 'wp-menu-separator' );
		}

		private function register_parented_menus( string $capability ): void {
			global $submenu;
			$parent   = (string) $this->config['parent_slug'];
			$callback = array( $this, 'render' );
			foreach ( $this->config['types'] as $key => $type ) {
				$slug         = $this->page_slug( $key );
				$plural       = strtolower( $type['plural'] );
				$singular     = strtolower( $type['singular'] );
				$tool_label   = $type['menu_title'] ?? $type['plural'];
				$add_label    = 'Add new ' . $singular;
				$manage_label = 'Manage ' . $plural . ' type';
				$submenu[ $parent ][] = array(
					'<span class="ci-tools-submenu-divider" aria-hidden="true"></span>',
					$capability,
					'ci-tools-divider-' . sanitize_key( $slug ),
				);
				add_submenu_page( $parent, $tool_label, $tool_label, $capability, $slug, $callback );
				add_submenu_page( $parent, $add_label, $add_label, $capability, $slug . '-new', $callback );
				add_submenu_page( $parent, $manage_label, $manage_label, $capability, $slug . '-manage', $callback );
				remove_submenu_page( $parent, $slug . '-new' );
				remove_submenu_page( $parent, $slug . '-manage' );
			}
			add_action( 'admin_head', array( $this, 'tools_submenu_styles' ) );
			add_action( 'admin_footer', array( $this, 'tools_submenu_accessibility' ) );
		}

		private function register_grouped_menus( string $capability ): void {
			global $submenu;
			$callback  = array( $this, 'render' );
			$menu_types = $this->config['grouped_menu_types'] ?? array_keys( $this->config['types'] );
			$first_key = (string) reset( $menu_types );
			$first     = $this->config['types'][ $first_key ];
			$parent    = $this->page_slug( $first_key );
			$menu_title = $this->config['menu_title'] ?? $first['plural'];
			add_menu_page(
				$menu_title,
				$menu_title,
				$capability,
				$parent,
				$callback,
				$this->config['menu_icon'] ?? $first['icon'] ?? 'dashicons-index-card',
				$this->config['position'] ?? null
			);
			foreach ( $menu_types as $key ) {
				$type = $this->config['types'][ $key ];
				if ( $first_key !== $key ) {
					$submenu[ $parent ][] = array(
						'<span class="ci-grouped-submenu-divider" aria-hidden="true"></span>',
						$capability,
						'ci-grouped-divider-' . sanitize_key( $type['plural'] ),
					);
				}
				$slug     = $this->page_slug( $key );
				$plural   = strtolower( $type['plural'] );
				$singular = strtolower( $type['singular'] );
				add_submenu_page( $parent, 'All ' . $plural, 'All ' . $plural, $capability, $slug, $callback );
				add_submenu_page( $parent, 'Add new ' . $singular, 'Add new ' . $singular, $capability, $slug . '-new', $callback );
				add_submenu_page( $parent, 'Manage ' . $plural . ' type', 'Manage ' . $plural . ' type', $capability, $slug . '-manage', $callback );
			}
			foreach ( array_diff( array_keys( $this->config['types'] ), $menu_types ) as $key ) {
				$type     = $this->config['types'][ $key ];
				$slug     = $this->page_slug( $key );
				$plural   = strtolower( $type['plural'] );
				$singular = strtolower( $type['singular'] );
				$hidden_pages = array(
					$slug             => 'All ' . $plural,
					$slug . '-new'     => 'Add new ' . $singular,
					$slug . '-manage'  => 'Manage ' . $plural . ' type',
				);
				foreach ( $hidden_pages as $page_slug => $label ) {
					add_submenu_page( $parent, $label, $label, $capability, $page_slug, $callback );
					remove_submenu_page( $parent, $page_slug );
				}
			}
			add_action( 'admin_head', array( $this, 'grouped_submenu_styles' ) );
			add_action( 'admin_footer', array( $this, 'grouped_submenu_accessibility' ) );
		}

		private function register_calendar_child_menus( string $capability ): bool {
			$mode = $this->config['mode'] ?? '';
			if ( ! in_array( $mode, array( 'reminders', 'routines' ), true ) ) {
				return false;
			}

			global $admin_page_hooks, $submenu;
			$parent = 'core-index-calendar-event';
			if ( empty( $admin_page_hooks[ $parent ] ) ) {
				return false;
			}

			$key      = (string) array_key_first( $this->config['types'] );
			$slug     = $this->page_slug( $key );
			$callback = array( $this, 'render' );
			$labels   = 'reminders' === $mode
				? array( 'plural' => 'reminders', 'singular' => 'reminder' )
				: array( 'plural' => 'automations', 'singular' => 'automation' );

			$submenu[ $parent ][] = array(
				'<span class="ci-grouped-submenu-divider" aria-hidden="true"></span>',
				$capability,
				'ci-grouped-divider-' . $labels['plural'],
			);
			add_submenu_page( $parent, 'All ' . $labels['plural'], 'All ' . $labels['plural'], $capability, $slug, $callback );
			add_submenu_page( $parent, 'Add new ' . $labels['singular'], 'Add new ' . $labels['singular'], $capability, $slug . '-new', $callback );
			add_submenu_page( $parent, 'Manage ' . $labels['plural'] . ' type', 'Manage ' . $labels['plural'] . ' type', $capability, $slug . '-manage', $callback );
			add_action( 'admin_head', array( $this, 'grouped_submenu_styles' ) );
			add_action( 'admin_footer', array( $this, 'grouped_submenu_accessibility' ) );
			return true;
		}

		public function grouped_submenu_styles(): void {
			echo '<style>
				#adminmenu li.ci-grouped-submenu-divider-item {
					border:0; display:block; height:21px !important; margin:0 12px !important;
					min-height:21px !important; padding:0 !important; position:relative;
				}
				#adminmenu li.ci-grouped-submenu-divider-item::before {
					border-top:1px solid rgba(255,255,255,.16); content:"";
					left:0; position:absolute; right:0; top:10px;
				}
				#adminmenu .ci-grouped-submenu-divider-item > a { display:none !important; }
				#adminmenu .wp-submenu a[href$="-manage"] {
					font-size:12px; white-space:nowrap;
				}
			</style>';
		}

		public function grouped_submenu_accessibility(): void {
			echo '<script>
				(() => {
					document.querySelectorAll("#adminmenu .ci-grouped-submenu-divider").forEach((divider) => {
						const item = divider.closest("li");
						if (!item) return;
						item.classList.add("ci-grouped-submenu-divider-item");
						item.setAttribute("role", "separator");
						item.setAttribute("aria-hidden", "true");
					});
				})();
			</script>';
		}

		public function tools_submenu_styles(): void {
			echo '<style>
				#adminmenu li.ci-tools-submenu-divider-item {
					border:0; display:block; height:21px !important; margin:0 12px !important;
					min-height:21px !important; padding:0 !important; position:relative;
				}
				#adminmenu li.ci-tools-submenu-divider-item::before {
					border-top:1px solid rgba(255,255,255,.16); content:"";
					left:0; position:absolute; right:0; top:10px;
				}
				#adminmenu .ci-tools-submenu-divider-item > a { display:none !important; }
				#menu-tools .wp-submenu > li.ci-tools-branch-parent { position:relative; }
				#menu-tools .wp-submenu > li.ci-tools-branch-parent > a {
					padding-right:28px; position:relative;
				}
				#menu-tools .wp-submenu > li.ci-tools-branch-parent > a::after {
					content:"›"; font-size:20px; line-height:1; position:absolute;
					right:10px; top:50%; transform:translateY(-52%);
				}
				body.wp-admin > .ci-tools-branch {
					background:#1d2327; box-shadow:0 3px 10px rgba(0,0,0,.32);
					display:none; margin:0; min-width:190px; padding:7px 0;
					position:fixed; z-index:100000;
				}
				body.wp-admin > .ci-tools-branch.ci-tools-branch-open { display:block; }
				body.wp-admin > .ci-tools-branch li { margin:0; padding:0; }
				body.wp-admin > .ci-tools-branch a {
					color:#c3c4c7; display:block; line-height:1.4; padding:6px 14px;
					text-decoration:none; white-space:nowrap;
				}
				body.wp-admin > .ci-tools-branch a:hover,
				body.wp-admin > .ci-tools-branch a:focus { color:#72aee6; }
				body.wp-admin > .ci-tools-branch li.current > a {
					border-left:4px solid #72aee6; color:#fff; padding-left:10px;
				}
			</style>';
		}

		public function tools_submenu_accessibility(): void {
			$groups = array();
			foreach ( $this->config['types'] as $key => $type ) {
				$slug     = $this->page_slug( $key );
				$plural   = strtolower( $type['plural'] );
				$singular = strtolower( $type['singular'] );
				$groups[] = array(
					'slug'  => $slug,
					'items' => array(
						array( 'label' => 'All ' . $plural, 'slug' => $slug ),
						array( 'label' => 'Add new ' . $singular, 'slug' => $slug . '-new' ),
						array( 'label' => 'Manage ' . $plural . ' type', 'slug' => $slug . '-manage' ),
					),
				);
			}
			echo '<script>
				(() => {
					document.querySelectorAll("#adminmenu .ci-tools-submenu-divider").forEach((divider) => {
						const item = divider.closest("li");
						if (!item) return;
						item.classList.add("ci-tools-submenu-divider-item");
						item.setAttribute("role", "separator");
						item.setAttribute("aria-hidden", "true");
					});
					const groups = ' . wp_json_encode( $groups ) . ';
					const currentPage = new URLSearchParams(window.location.search).get("page") || "";
					const directLinks = [...document.querySelectorAll("#menu-tools .wp-submenu > li > a")];
					groups.forEach((group) => {
						const trigger = directLinks.find((link) => {
							try {
								return new URL(link.href, window.location.href).searchParams.get("page") === group.slug;
							} catch (error) {
								return false;
							}
						});
						if (!trigger) return;
						const parent = trigger.closest("li");
						if (!parent || trigger.hasAttribute("aria-controls")) return;
						parent.classList.add("ci-tools-branch-parent");
						trigger.setAttribute("aria-haspopup", "true");
						trigger.setAttribute("aria-expanded", "false");
						const branch = document.createElement("ul");
						branch.id = "ci-tools-branch-" + group.slug;
						branch.className = "ci-tools-branch";
						branch.setAttribute("role", "menu");
						branch.setAttribute("aria-label", trigger.textContent.trim());
						trigger.setAttribute("aria-controls", branch.id);
						parent.setAttribute("aria-owns", branch.id);
						group.items.forEach((item) => {
							const row = document.createElement("li");
							const link = document.createElement("a");
							link.href = "tools.php?page=" + encodeURIComponent(item.slug);
							link.textContent = item.label;
							link.setAttribute("role", "menuitem");
							if (currentPage === item.slug) {
								row.classList.add("current");
								parent.classList.add("current");
							}
							row.appendChild(link);
							branch.appendChild(row);
						});
						document.body.appendChild(branch);
						let closeTimer = null;
						const positionBranch = () => {
							const rect = parent.getBoundingClientRect();
							const branchHeight = branch.offsetHeight || 112;
							const top = Math.max(32, Math.min(rect.top - 7, window.innerHeight - branchHeight - 8));
							branch.style.left = rect.right + "px";
							branch.style.top = top + "px";
						};
						const setOpen = (open) => {
							parent.classList.toggle("ci-tools-branch-open", open);
							branch.classList.toggle("ci-tools-branch-open", open);
							trigger.setAttribute("aria-expanded", open ? "true" : "false");
							if (open) positionBranch();
						};
						const openBranch = () => {
							window.clearTimeout(closeTimer);
							setOpen(true);
						};
						const closeBranch = () => {
							window.clearTimeout(closeTimer);
							closeTimer = window.setTimeout(() => {
								if (!parent.contains(document.activeElement) && !branch.contains(document.activeElement)) {
									setOpen(false);
								}
							}, 120);
						};
						parent.addEventListener("mouseenter", openBranch);
						parent.addEventListener("mouseleave", closeBranch);
						branch.addEventListener("mouseenter", openBranch);
						branch.addEventListener("mouseleave", closeBranch);
						parent.addEventListener("focusin", openBranch);
						parent.addEventListener("focusout", (event) => {
							if (!parent.contains(event.relatedTarget) && !branch.contains(event.relatedTarget)) closeBranch();
						});
						branch.addEventListener("focusin", openBranch);
						branch.addEventListener("focusout", (event) => {
							if (!parent.contains(event.relatedTarget) && !branch.contains(event.relatedTarget)) closeBranch();
						});
						trigger.addEventListener("keydown", (event) => {
							if ("ArrowRight" !== event.key) return;
							event.preventDefault();
							openBranch();
							branch.querySelector("a")?.focus();
						});
						branch.addEventListener("keydown", (event) => {
							if ("Escape" !== event.key && "ArrowLeft" !== event.key) return;
							event.preventDefault();
							setOpen(false);
							trigger.focus();
						});
						window.addEventListener("resize", () => {
							if (branch.classList.contains("ci-tools-branch-open")) positionBranch();
						});
					});
				})();
			</script>';
		}

		public function render(): void {
			echo '<div class="wrap" style="margin:0;padding:0;max-width:none"><div id="ci-root"></div></div>';
		}

		public function enqueue(): void {
			if ( ! $this->is_page() ) {
				return;
			}
			remove_action( 'admin_print_scripts', 'print_emoji_detection_script' );
			remove_action( 'admin_print_styles', 'print_emoji_styles' );
			if ( function_exists( 'wp_deregister_script_module' ) ) {
				wp_deregister_script_module( '@wordpress/latex-to-mathml' );
			}

			$base = plugin_dir_url( $this->file ) . 'assets/';
			$dir  = plugin_dir_path( $this->file ) . 'assets/';
			$ver  = static fn( string $path ): string => file_exists( $dir . $path ) ? (string) filemtime( $dir . $path ) : '1';

			wp_enqueue_script( 'wp-element' );
			wp_enqueue_script( 'wp-components' );
			wp_enqueue_style( 'wp-components' );
			wp_enqueue_style( $this->handle . '-identity', $base . 'wpds-identity.css', array(), $ver( 'wpds-identity.css' ) );
			wp_enqueue_script( $this->handle . '-identity-runtime', $base . 'wpds-identity.js', array(), $ver( 'wpds-identity.js' ), false );
			wp_enqueue_script( $this->handle . '-identity', $base . 'ci-identity.js', array( $this->handle . '-identity-runtime' ), $ver( 'ci-identity.js' ), true );
			wp_enqueue_style( $this->handle . '-shell', $base . 'context-app-shell.css', array(), $ver( 'context-app-shell.css' ) );
			wp_enqueue_style( $this->handle . '-reset', $base . 'ci-reset.css', array(), $ver( 'ci-reset.css' ) );
			wp_enqueue_style( $this->handle . '-utils', $base . 'ci-utils.css', array( $this->handle . '-reset' ), $ver( 'ci-utils.css' ) );
			wp_enqueue_style( $this->handle . '-theme', $base . 'ci-wpds-theme.css', array( $this->handle . '-utils' ), $ver( 'ci-wpds-theme.css' ) );
			wp_enqueue_style( $this->handle . '-dataviews', $base . 'vendor/wp-dataviews.css', array( $this->handle . '-theme' ), $ver( 'vendor/wp-dataviews.css' ) );
			wp_enqueue_style( $this->handle . '-dataviews-skin', $base . 'ci-dataviews-skin.css', array( $this->handle . '-dataviews' ), $ver( 'ci-dataviews-skin.css' ) );
			wp_enqueue_script( $this->handle . '-shell', $base . 'context-app-shell.js', array(), $ver( 'context-app-shell.js' ), false );
			wp_enqueue_script(
				$this->handle,
				$base . 'context-app.js',
				array(
					$this->handle . '-shell',
					'wp-element',
					'wp-components',
					'wp-block-editor',
					'wp-blocks',
					'wp-block-library',
					'wp-data',
					'wp-keyboard-shortcuts',
					'wp-format-library',
				),
				$ver( 'context-app.js' ),
				true
			);
			wp_enqueue_style( 'wp-block-library' );
			wp_enqueue_style( 'wp-edit-blocks' );
			wp_enqueue_style( 'wp-block-editor' );
			wp_enqueue_style( 'wp-format-library' );
			if ( current_user_can( 'manage_options' ) ) {
				wp_enqueue_style(
					$this->handle . '-ai-chat',
					$base . 'ci-ai-chat.css',
					array( 'wp-components' ),
					$ver( 'ci-ai-chat.css' )
				);
				wp_enqueue_script(
					$this->handle . '-ai-chat',
					$base . 'ci-ai-chat.js',
					array( $this->handle ),
					$ver( 'ci-ai-chat.js' ),
					true
				);
			}
			wp_add_inline_script( $this->handle, 'window.CI_BOOTSTRAP=' . wp_json_encode( $this->bootstrap() ) . ';', 'before' );
			$identity_type = reset( $this->config['types'] );
			$identity_title = (string) ( $this->config['menu_title'] ?? $identity_type['plural'] ?? $this->config['slug'] );
			wp_add_inline_script( $this->handle . '-identity', 'window.CI_WPDS_IDENTITY=' . wp_json_encode( array( 'title' => $identity_title ) ) . ';', 'before' );
		}

		public function module_tag( string $tag, string $handle, string $src ): string {
			if ( ! in_array( $handle, array( $this->handle, $this->handle . '-ai-chat' ), true ) ) {
				return $tag;
			}
			return (string) preg_replace( '/<script(?=[^>]*\bsrc=)/', '<script type="module"', $tag, 1 );
		}

		public function print_importmap(): void {
			if ( ! $this->is_page() ) {
				return;
			}
			$base = plugin_dir_url( $this->file ) . 'assets/';
			$dir  = plugin_dir_path( $this->file ) . 'assets/';
			$url  = static function ( string $path ) use ( $base, $dir ): string {
				return $base . $path . '?v=' . ( file_exists( $dir . $path ) ? filemtime( $dir . $path ) : 1 );
			};
			$imports = array(
				'ci/core' => $url( 'ci-core.js' ), 'ci/ui' => $url( 'ci-ui.js' ),
				'ci/engine' => $url( 'ci-engine.js' ), 'ci/shell' => $url( 'ci-shell.js' ),
				'ci/editors' => $url( 'ci-editors.js' ), 'ci/app-media' => $url( 'ci-app-media.js' ),
				'ci/app-wizards' => $url( 'ci-app-wizards.js' ), 'ci/editor-chrome' => $url( 'ci-editor-chrome.js' ),
				'ci/skill-mermaid' => $url( 'ci-skill-mermaid.js' ), 'ci/app-activity' => $url( 'ci-app-activity.js' ),
				'ci/app-notifications' => $url( 'ci-app-notifications.js' ), 'ci/app-apps' => $url( 'ci-app-apps.js' ),
				'ci/app-workspace' => $url( 'ci-app-workspace.js' ), 'ci/type' => $url( 'ci-type.js' ),
				'ci/blueprints' => $url( 'ci-blueprints.js' ),
				'ci/app-reminders' => $url( 'ci-app-reminders.js' ),
				'ci/app-filesystem' => $url( 'ci-app-filesystem.js' ),
				'ci/app-code' => $url( 'ci-app-code.js' ),
				'react' => $url( 'bridge-react.js' ), 'react-dom' => $url( 'bridge-react-dom-client.js' ),
				'react-dom/client' => $url( 'bridge-react-dom-client.js' ), 'react/jsx-runtime' => $url( 'bridge-react-jsx-runtime.js' ),
				'@wordpress/components' => $url( 'bridge-wp-components.js' ),
				'@wordpress/latex-to-mathml' => $url( 'bridge-noop.js' ),
				'@wordpress/block-editor' => $url( 'bridge-wp-block-editor.js' ),
				'@wordpress/blocks' => $url( 'bridge-wp-blocks.js' ), '@wordpress/data' => $url( 'bridge-wp-data.js' ),
				'@wordpress/keyboard-shortcuts' => $url( 'bridge-wp-keyboard-shortcuts.js' ),
				'react-router-dom' => $url( 'vendor/react-router-dom.js' ), 'htm' => $url( 'vendor/htm.js' ),
				'codemirror' => $url( 'vendor/codemirror.js' ), '@codemirror/state' => $url( 'vendor/codemirror.js' ),
				'@codemirror/view' => $url( 'vendor/codemirror.js' ), '@codemirror/language' => $url( 'vendor/codemirror.js' ),
				'@codemirror/commands' => $url( 'vendor/codemirror.js' ), '@codemirror/lang-markdown' => $url( 'vendor/codemirror.js' ),
				'@wordpress/dataviews' => $url( 'vendor/wp-dataviews.js' ), 'marked' => $url( 'vendor/marked.js' ),
				'mermaid' => $url( 'vendor/mermaid.js' ), '@ci/fa-icons' => $url( 'vendor/fa-icons.js' ),
				'@xyflow/react' => $url( 'vendor/xyflow-react.js' ),
			);
			$providers = (array) ( $this->config['editor_providers'] ?? array() );
			if ( in_array( 'llm', $providers, true ) ) {
				$imports['ci/app-llm'] = $url( 'ci-app-llm.js' );
				$canvas_dir = $dir . 'llm-editor/';
				if ( is_dir( $canvas_dir ) ) {
					$iterator = new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $canvas_dir, FilesystemIterator::SKIP_DOTS ) );
					foreach ( $iterator as $asset ) {
						if ( ! $asset->isFile() || 'js' !== strtolower( $asset->getExtension() ) ) {
							continue;
						}
						$relative = 'llm-editor/' . str_replace( DIRECTORY_SEPARATOR, '/', substr( $asset->getPathname(), strlen( $canvas_dir ) ) );
						$imports[ $base . $relative ] = $url( $relative );
					}
				}
			}
			if ( in_array( 'csv', $providers, true ) ) {
				$imports['ci/app-csv'] = $url( 'ci-app-csv.js' );
			}
			if ( in_array( 'source', $providers, true ) ) {
				$imports['ci/app-source'] = $url( 'ci-app-source.js' );
			}
			wp_print_inline_script_tag( (string) wp_json_encode( array( 'imports' => $imports ) ), array( 'type' => 'importmap' ) );
		}

		public function routes(): void {
			$namespace = $this->config['rest_ns'];
			register_rest_route( $namespace, '/settings', array(
				'methods' => WP_REST_Server::READABLE, 'permission_callback' => array( $this, 'can_configure' ),
				'callback' => fn() => rest_ensure_response( $this->settings_payload() ),
			) );
			register_rest_route( $namespace, '/settings/field-groups', array(
				'methods' => WP_REST_Server::CREATABLE, 'permission_callback' => array( $this, 'can_configure' ),
				'callback' => array( $this, 'save_field_group' ),
			) );
			register_rest_route( $namespace, '/cpt-schema/(?P<cpt>[a-z0-9_-]+)', array(
				'methods' => WP_REST_Server::READABLE, 'permission_callback' => array( $this, 'can_edit' ),
				'callback' => array( $this, 'cpt_schema' ),
			) );
			register_rest_route( $namespace, '/settings/taxonomies', array(
				'methods' => 'POST,DELETE', 'permission_callback' => array( $this, 'can_configure' ),
				'callback' => 'content-types' === ( $this->config['mode'] ?? '' )
					? array( $this, 'save_taxonomy' )
					: fn() => rest_ensure_response( array( 'ok' => true ) ),
			) );
			if ( 'content-types' === ( $this->config['mode'] ?? '' ) ) {
				register_rest_route( $namespace, '/settings/custom-cpts', array(
					array(
						'methods' => WP_REST_Server::CREATABLE, 'permission_callback' => array( $this, 'can_configure' ),
						'callback' => array( $this, 'create_content_type' ),
					),
					array(
						'methods' => WP_REST_Server::DELETABLE, 'permission_callback' => array( $this, 'can_configure' ),
						'callback' => array( $this, 'delete_content_type' ),
					),
				) );
				register_rest_route( $namespace, '/settings/schema-override', array(
					'methods' => 'POST,DELETE', 'permission_callback' => array( $this, 'can_configure' ),
					'callback' => array( $this, 'save_schema_override' ),
				) );
				register_rest_route( $namespace, '/settings/agents-override', array(
					'methods' => 'POST,DELETE', 'permission_callback' => array( $this, 'can_configure' ),
					'callback' => array( $this, 'save_agents_override' ),
				) );
			}
			if ( 'activity' === ( $this->config['mode'] ?? '' ) ) {
				register_rest_route( $namespace, '/activity', array(
					'methods' => WP_REST_Server::READABLE, 'permission_callback' => array( $this, 'can_edit' ),
					'callback' => array( $this, 'activity_feed' ),
				) );
				register_rest_route( $namespace, '/activity/log', array(
					'methods' => WP_REST_Server::DELETABLE, 'permission_callback' => array( $this, 'can_edit' ),
					'callback' => fn() => rest_ensure_response( array( 'ok' => true ) ),
				) );
			}
			register_rest_route( $namespace, '/notifications', array(
				'methods' => WP_REST_Server::READABLE, 'permission_callback' => array( $this, 'can_edit' ),
				'callback' => array( $this, 'notifications_feed' ),
			) );
			register_rest_route( $namespace, '/notifications/read', array(
				'methods' => WP_REST_Server::CREATABLE, 'permission_callback' => array( $this, 'can_edit' ),
				'callback' => array( $this, 'notifications_read' ),
			) );
			if ( 'graph' === ( $this->config['mode'] ?? '' ) ) {
				register_rest_route( $namespace, '/graph', array(
					'methods' => WP_REST_Server::READABLE, 'permission_callback' => array( $this, 'can_edit' ),
					'callback' => array( $this, 'graph_feed' ),
				) );
			}
			if ( 'wizard' === ( $this->config['mode'] ?? '' ) ) {
				register_rest_route( $namespace, '/preview/render', array(
					'methods' => WP_REST_Server::CREATABLE, 'permission_callback' => array( $this, 'can_edit' ),
					'callback' => static function ( WP_REST_Request $request ): WP_REST_Response {
						$content = (string) $request->get_param( 'content' );
						return new WP_REST_Response( array( 'html' => do_blocks( $content ) ) );
					},
				) );
			}
			if ( in_array( $this->config['mode'] ?? '', array( 'calendar', 'reminders', 'routines' ), true ) ) {
				register_rest_route( $namespace, '/reminders/automation', array(
					'methods' => WP_REST_Server::READABLE, 'permission_callback' => array( $this, 'can_edit' ),
					'callback' => fn() => rest_ensure_response( array( 'count' => wp_count_posts( 'os_automation' )->publish ?? 0 ) ),
				) );
				register_rest_route( $namespace, '/reminders/automation/(?P<id>\d+)/log', array(
					'methods' => 'GET,DELETE', 'permission_callback' => array( $this, 'can_edit' ),
					'callback' => fn() => rest_ensure_response( array() ),
				) );
				register_rest_route( $namespace, '/reminders/automation/test', array(
					'methods' => WP_REST_Server::CREATABLE, 'permission_callback' => array( $this, 'can_edit' ),
					'callback' => fn() => rest_ensure_response( array( 'ok' => true ) ),
				) );
			}
			$compat_namespaces = (array) ( $this->config['compat_rest_namespaces'] ?? array() );
			if ( 'content-types' === ( $this->config['mode'] ?? '' ) && ! class_exists( 'Core_Index_Settings' ) ) {
				// The extracted CI type editor still speaks the original shared
				// namespace. Content Types owns those kernel routes after split,
				// but must not shadow a partially migrated monolith.
				$compat_namespaces[] = 'os-index/v1';
			}
			foreach ( array_unique( $compat_namespaces ) as $compat_namespace ) {
				$this->register_compatibility_routes( (string) $compat_namespace );
			}
		}

		private function register_compatibility_routes( string $namespace ): void {
			register_rest_route( $namespace, '/settings', array(
				'methods' => WP_REST_Server::READABLE, 'permission_callback' => array( $this, 'can_configure' ),
				'callback' => fn() => rest_ensure_response( $this->settings_payload() ),
			) );
			register_rest_route( $namespace, '/settings/field-groups', array(
				'methods' => WP_REST_Server::CREATABLE, 'permission_callback' => array( $this, 'can_configure' ),
				'callback' => array( $this, 'save_field_group' ),
			) );
			register_rest_route( $namespace, '/cpt-schema/(?P<cpt>[a-z0-9_-]+)', array(
				'methods' => WP_REST_Server::READABLE, 'permission_callback' => array( $this, 'can_edit' ),
				'callback' => array( $this, 'cpt_schema' ),
			) );
			register_rest_route( $namespace, '/settings/taxonomies', array(
				'methods' => 'POST,DELETE', 'permission_callback' => array( $this, 'can_configure' ),
				'callback' => 'content-types' === ( $this->config['mode'] ?? '' )
					? array( $this, 'save_taxonomy' )
					: fn() => rest_ensure_response( array( 'ok' => true ) ),
			) );
			if ( 'content-types' === ( $this->config['mode'] ?? '' ) ) {
				register_rest_route( $namespace, '/settings/custom-cpts', array(
					array(
						'methods' => WP_REST_Server::CREATABLE, 'permission_callback' => array( $this, 'can_configure' ),
						'callback' => array( $this, 'create_content_type' ),
					),
					array(
						'methods' => WP_REST_Server::DELETABLE, 'permission_callback' => array( $this, 'can_configure' ),
						'callback' => array( $this, 'delete_content_type' ),
					),
				) );
				register_rest_route( $namespace, '/settings/schema-override', array(
					'methods' => 'POST,DELETE', 'permission_callback' => array( $this, 'can_configure' ),
					'callback' => array( $this, 'save_schema_override' ),
				) );
				register_rest_route( $namespace, '/settings/agents-override', array(
					'methods' => 'POST,DELETE', 'permission_callback' => array( $this, 'can_configure' ),
					'callback' => array( $this, 'save_agents_override' ),
				) );
			}
			register_rest_route( $namespace, '/notifications', array(
				'methods' => WP_REST_Server::READABLE, 'permission_callback' => array( $this, 'can_edit' ),
				'callback' => array( $this, 'notifications_feed' ),
			) );
			register_rest_route( $namespace, '/notifications/read', array(
				'methods' => WP_REST_Server::CREATABLE, 'permission_callback' => array( $this, 'can_edit' ),
				'callback' => array( $this, 'notifications_read' ),
			) );
			register_rest_route( $namespace, '/reminders/automation', array(
				'methods' => WP_REST_Server::READABLE, 'permission_callback' => array( $this, 'can_edit' ),
				'callback' => fn() => rest_ensure_response( array( 'count' => wp_count_posts( 'os_automation' )->publish ?? 0 ) ),
			) );
			register_rest_route( $namespace, '/reminders/automation/(?P<id>\d+)/log', array(
				'methods' => 'GET,DELETE', 'permission_callback' => array( $this, 'can_edit' ),
				'callback' => fn() => rest_ensure_response( array() ),
			) );
			register_rest_route( $namespace, '/reminders/automation/test', array(
				'methods' => WP_REST_Server::CREATABLE, 'permission_callback' => array( $this, 'can_edit' ),
				'callback' => fn() => rest_ensure_response( array( 'ok' => true ) ),
			) );
		}

		/**
		 * Keep shared index feeds inside WordPress's object-level read boundary.
		 *
		 * The route capability only decides whether a user may open the product
		 * application. Individual private and draft records still require their
		 * own `read_post` permission.
		 *
		 * @param WP_Post[] $posts Candidate records.
		 * @return WP_Post[]
		 */
		private static function readable_posts( array $posts ): array {
			return array_values(
				array_filter(
					$posts,
					static fn( $post ): bool => $post instanceof WP_Post && current_user_can( 'read_post', $post->ID )
				)
			);
		}

		public function activity_feed(): WP_REST_Response {
			$type  = $this->config['types']['activity']['post_type'] ?? 'os_activity';
			$posts = self::readable_posts( get_posts( array( 'post_type' => $type, 'post_status' => 'any', 'posts_per_page' => 80, 'orderby' => 'date', 'order' => 'DESC' ) ) );
			$events = array_map( static function ( WP_Post $post ): array {
				return array(
					't' => (int) get_post_time( 'U', true, $post ),
					'type' => (string) ( get_post_meta( $post->ID, 'activity_event', true ) ?: 'activity' ),
					'summary' => get_the_title( $post ), 'actor' => get_the_author_meta( 'display_name', $post->post_author ),
				);
			}, $posts );
			return new WP_REST_Response( array(
				'server_time' => time(), 'events' => $events, 'invocations' => array(),
				'cron' => array(), 'automations' => array(),
				'reminders' => array( 'pending' => 0, 'done' => 0, 'next_run' => 0 ),
				'agents' => array(),
			) );
		}

		public function notifications_feed(): WP_REST_Response {
			$type    = $this->config['types']['notification']['post_type'] ?? '__ci_no_notifications';
			$read_at = (int) get_user_meta( get_current_user_id(), $this->field_option() . '_read_at', true );
			$posts   = self::readable_posts( get_posts( array( 'post_type' => $type, 'post_status' => 'any', 'posts_per_page' => 100, 'orderby' => 'date', 'order' => 'DESC' ) ) );
			$items   = array_map( static function ( WP_Post $post ): array {
				$payload = get_post_meta( $post->ID, 'notifications_payload', true );
				$payload = is_array( $payload ) ? $payload : array();
				return array(
					'id' => $post->ID, 't' => (int) get_post_time( 'U', true, $post ),
					'title' => get_the_title( $post ), 'detail' => wp_strip_all_tags( $post->post_content ),
					'severity' => $payload['severity'] ?? 'info',
					'source' => (string) ( get_post_meta( $post->ID, 'notifications_source', true ) ?: 'WordPress' ),
					'link' => '',
				);
			}, $posts );
			$unread = count( array_filter( $items, static fn( array $item ): bool => $item['t'] > $read_at ) );
			return new WP_REST_Response( array( 'items' => $items, 'unread_count' => $unread, 'read_at' => $read_at, 'server_time' => time() ) );
		}

		public function notifications_read(): WP_REST_Response {
			$read_at = time();
			update_user_meta( get_current_user_id(), $this->field_option() . '_read_at', $read_at );
			return new WP_REST_Response( array( 'read_at' => $read_at ) );
		}

		public function graph_feed(): WP_REST_Response {
			$type  = $this->config['types']['node']['post_type'] ?? 'os_knowledge_node';
			$posts = self::readable_posts( get_posts( array( 'post_type' => $type, 'post_status' => 'any', 'posts_per_page' => 500 ) ) );
			$visible_ids = array_fill_keys( array_map( static fn( WP_Post $post ): int => $post->ID, $posts ), true );
			$nodes = array_map( static fn( WP_Post $post ): array => array(
				'id' => $post->ID, 'type' => 'node', 'title' => get_the_title( $post ),
				'slug' => $post->post_name, 'broken' => false,
			), $posts );
			$edges = array();
			foreach ( $posts as $post ) {
				$relations = get_post_meta( $post->ID, 'knowledge_graph_relations', true );
				foreach ( is_array( $relations ) ? $relations : array() as $relation ) {
					$target = (int) ( $relation['target'] ?? 0 );
					if ( $target && isset( $visible_ids[ $target ] ) ) {
						$edges[] = array( 'from' => $post->ID, 'to' => $target );
					}
				}
			}
			return new WP_REST_Response( array( 'nodes' => $nodes, 'edges' => $edges ) );
		}

		/**
		 * Return active definitions for one generated post type in stable order.
		 *
		 * Older versions could insert the same definition more than once. The
		 * lowest post ID is the canonical record; callers deliberately update
		 * only that record and report, rather than overwrite, later duplicates.
		 *
		 * @return WP_Post[]
		 */
		private function content_type_definitions( string $cpt ): array {
			$matches = array();
			foreach ( get_posts(
				array(
					'post_type'      => 'os_content_type',
					'post_status'    => 'any',
					'posts_per_page' => -1,
					'orderby'        => 'ID',
					'order'          => 'ASC',
				)
			) as $post ) {
				// A definition written before the namespace rename is keyed `ci_`
				// while this runtime computes `os_`. Match either, or every
				// pre-migration content type becomes invisible to its own editor.
				$stored = sanitize_key( (string) get_post_meta( $post->ID, 'content_types_type_key', true ) );
				$bare   = preg_replace( '/^(ci|os)_/', '', $cpt );
				if ( $stored === $cpt || $stored === 'ci_' . $bare || $stored === 'os_' . $bare ) {
					$matches[] = $post;
				}
			}
			usort( $matches, static fn( $left, $right ): int => $left->ID <=> $right->ID );
			return $matches;
		}

		private function content_type_key_is_reserved( string $cpt ): bool {
			return in_array(
				$cpt,
				array(
					'os_skill',
					'os_wiki',
					'os_memory',
					'ci_artifact',
					'os_snippet',
					'os_code',
					'os_csv',
					'ci_issue',
					'ci_project',
					'os_wizard',
					'os_reminder',
					'os_automation',
					'os_agent',
				),
				true
			);
		}

		public function create_content_type( WP_REST_Request $request ) {
			if ( ! $this->can_configure() ) {
				return new WP_Error( 'forbidden', 'You are not allowed to manage content types.', array( 'status' => 403 ) );
			}

			$requested_slug = strtolower( trim( (string) $request->get_param( 'slug' ) ) );
			// Accept a slug that already carries either prefix and normalise it,
			// so `skill`, `os_skill`, and `os_skill` all name the same type.
			$slug           = preg_replace( '/^(ci|os)_/', '', $requested_slug );
			if ( ! is_string( $slug ) || ! preg_match( '/^[a-z0-9](?:[a-z0-9_]*[a-z0-9])?$/', $slug ) ) {
				return new WP_Error(
					'invalid_content_type_slug',
					'Slug must use lowercase letters, digits, and underscores, without leading or trailing underscores.',
					array( 'status' => 400 )
				);
			}
			// New content types are minted in the frozen namespace. Existing ones
			// may still carry `ci_` until `wp ci migrate-types` has run, which is
			// why every lookup below accepts either prefix.
			$cpt = 'os_' . $slug;
			if ( strlen( $cpt ) > 20 ) {
				return new WP_Error(
					'content_type_key_too_long',
					'The final post type key may not exceed 20 characters, including the os_ prefix.',
					array( 'status' => 400, 'cpt' => $cpt )
				);
			}
			if ( $this->content_type_key_is_reserved( $cpt ) ) {
				return new WP_Error(
					'reserved_content_type',
					'That content type key is reserved by Core Index.',
					array( 'status' => 400, 'cpt' => $cpt )
				);
			}

			$is_update  = (bool) $request->get_param( 'update' );
			$definitions = $this->content_type_definitions( $cpt );
			if ( $definitions && ! $is_update ) {
				return new WP_Error(
					'content_type_exists',
					'A content type with that key already exists. Send update=true to update it.',
					array( 'status' => 409, 'cpt' => $cpt )
				);
			}

			if ( post_type_exists( $cpt ) ) {
				$owned_dynamic_type = class_exists( 'Core_Index_Content_Types_Dynamic_Types' )
					&& is_callable( array( 'Core_Index_Content_Types_Dynamic_Types', 'owns' ) )
					&& Core_Index_Content_Types_Dynamic_Types::owns( $cpt );
				if ( ! $definitions || ( class_exists( 'Core_Index_Content_Types_Dynamic_Types' ) && ! $owned_dynamic_type ) ) {
					return new WP_Error(
						'post_type_conflict',
						'A registered post type already uses that key.',
						array( 'status' => 409, 'cpt' => $cpt )
					);
				}
			}

			$definition = $definitions[0] ?? null;
			$created    = ! $definition;
			$post_id    = $definition ? (int) $definition->ID : 0;
			$old_config = $post_id ? get_post_meta( $post_id, 'content_types_config', true ) : array();
			$config     = is_array( $old_config ) ? $old_config : array();

			$label_param = $request->get_param( 'label' );
			$label       = null !== $label_param
				? sanitize_text_field( (string) $label_param )
				: ( $post_id ? sanitize_text_field( (string) get_post_meta( $post_id, 'content_types_singular', true ) ) : '' );
			if ( '' === $label ) {
				return new WP_Error( 'invalid_content_type_label', 'A singular label is required.', array( 'status' => 400 ) );
			}
			$plural_param = $request->get_param( 'plural' );
			$plural       = null !== $plural_param
				? sanitize_text_field( (string) $plural_param )
				: ( $post_id ? sanitize_text_field( (string) get_post_meta( $post_id, 'content_types_plural', true ) ) : '' );
			$plural       = '' !== $plural ? $plural : $label;

			if ( $post_id ) {
				$updated_id = wp_update_post(
					array(
						'ID'         => $post_id,
						'post_title' => $label,
					),
					true
				);
				if ( is_wp_error( $updated_id ) ) {
					return $updated_id;
				}
			} else {
				$post_id = wp_insert_post(
					array(
						'post_type'   => 'os_content_type',
						'post_status' => 'publish',
						'post_title'  => $label,
					),
					true
				);
				if ( is_wp_error( $post_id ) ) {
					return $post_id;
				}
				$post_id = (int) $post_id;
			}

			$config['slug']   = $slug;
			$config['label']  = $label;
			$config['plural'] = $plural;

			$editors_param = $request->get_param( 'editors' );
			if ( null !== $editors_param ) {
				$editors = array();
				foreach ( (array) $editors_param as $editor_key ) {
					$editor_key = sanitize_key( (string) $editor_key );
					if ( '' !== $editor_key && ! in_array( $editor_key, $editors, true ) ) {
						$editors[] = $editor_key;
					}
				}
				$config['editors'] = $editors ?: array( 'cpt' );
			} elseif ( $created && empty( $config['editors'] ) ) {
				$config['editors'] = array( 'cpt' );
			}

			$editor_param = $request->get_param( 'editor' );
			if ( null !== $editor_param ) {
				$editor = sanitize_key( (string) $editor_param );
				$config['editor'] = '' !== $editor ? $editor : ( $config['editors'][0] ?? 'cpt' );
			} elseif ( $created && empty( $config['editor'] ) ) {
				$config['editor'] = $config['editors'][0] ?? 'cpt';
			}

			$conditional_values = array(
				'editor_mode'  => static fn( $value ) => in_array( $value, array( 'md', 'block' ), true ) ? $value : 'md',
				'path_template' => static fn( $value ) => sanitize_text_field( (string) $value ),
				'hierarchical' => static fn( $value ) => (bool) $value,
				'icon'         => static fn( $value ) => sanitize_key( (string) $value ),
				'icon_svg'     => static fn( $value ) => Core_Index_Icon_SVG_Sanitizer::sanitize( (string) $value ),
			);
			foreach ( $conditional_values as $key => $sanitize ) {
				$value = $request->get_param( $key );
				if ( null !== $value ) {
					$config[ $key ] = $sanitize( $value );
				}
			}
			if ( $created && ! array_key_exists( 'hierarchical', $config ) ) {
				$config['hierarchical'] = false;
			}
			$config['icon_svg'] = Core_Index_Icon_SVG_Sanitizer::sanitize( (string) ( $config['icon_svg'] ?? '' ) );

			update_post_meta( $post_id, 'content_types_type_key', $cpt );
			update_post_meta( $post_id, 'content_types_singular', $label );
			update_post_meta( $post_id, 'content_types_plural', $plural );
			update_post_meta( $post_id, 'content_types_config', $config );

			$fields = $request->get_param( 'fields' );
			if ( is_array( $fields ) ) {
				$all = $this->field_groups();
				$all[ $cpt ] = array( 'version' => 1, 'fields' => $this->sanitize_tree( $fields ), 'display' => $this->sanitize_tree( (array) $request->get_param( 'field_display' ) ) );
				update_option( $this->field_option(), $all, false );
			}
			return rest_ensure_response(
				array(
					'ok'                    => true,
					'created'               => $created,
					'slug'                  => $slug,
					'cpt'                   => $cpt,
					'id'                    => $post_id,
					'duplicate_definitions' => max( 0, count( $definitions ) - 1 ),
				)
			);
		}

		public function delete_content_type( WP_REST_Request $request ): WP_REST_Response|WP_Error {
			if ( ! $this->can_configure() ) {
				return new WP_Error( 'forbidden', 'You are not allowed to manage content types.', array( 'status' => 403 ) );
			}
			$slug = preg_replace( '/^(ci|os)_/', '', sanitize_key( (string) $request->get_param( 'slug' ) ) );
			foreach ( get_posts( array( 'post_type' => 'os_content_type', 'post_status' => 'any', 'posts_per_page' => -1 ) ) as $post ) {
				$stored = get_post_meta( $post->ID, 'content_types_type_key', true );
				if ( 'os_' . $slug === $stored || 'ci_' . $slug === $stored ) {
					wp_trash_post( $post->ID );
				}
			}
			return new WP_REST_Response( array( 'ok' => true ) );
		}

		public function register_content_taxonomies(): void {
			foreach ( $this->content_taxonomies() as $taxonomy ) {
				$slug = sanitize_key( (string) ( $taxonomy['slug'] ?? '' ) );
				$cpts = array_values( array_filter( array_map( 'sanitize_key', (array) ( $taxonomy['cpts'] ?? array() ) ) ) );
				if ( '' === $slug || ! $cpts || taxonomy_exists( $slug ) ) {
					continue;
				}
				$label    = sanitize_text_field( (string) ( $taxonomy['label'] ?? $slug ) );
				$singular = sanitize_text_field( (string) ( $taxonomy['singular'] ?? $label ) );
				register_taxonomy(
					$slug,
					$cpts,
					array(
						'labels'       => array( 'name' => $label, 'singular_name' => $singular ),
						'public'       => false,
						'show_ui'      => true,
						'show_in_rest' => true,
						'hierarchical' => ! empty( $taxonomy['hierarchical'] ),
					)
				);
			}
		}

		public function save_taxonomy( WP_REST_Request $request ) {
			if ( ! $this->can_configure() ) {
				return new WP_Error( 'forbidden', 'You are not allowed to manage taxonomies.', array( 'status' => 403 ) );
			}
			$slug = sanitize_key( (string) $request->get_param( 'slug' ) );
			if ( 'DELETE' === $request->get_method() ) {
				$next = array_values(
					array_filter(
						$this->content_taxonomies(),
						static fn( $row ): bool => $slug !== (string) ( $row['slug'] ?? '' )
					)
				);
				update_option( $this->content_option( 'taxonomies' ), $next, false );
				return new WP_REST_Response( array( 'ok' => true, 'taxonomies' => $next, 'requires_reload' => true ) );
			}
			if ( ! preg_match( '/^[a-z][a-z0-9_]{0,30}$/', $slug ) || strlen( $slug ) > 32 ) {
				return new WP_Error( 'bad_slug', 'Taxonomy slug must be 1-32 lowercase letters, digits, or underscores, starting with a letter.', array( 'status' => 400 ) );
			}
			$cpts = array_values(
				array_unique(
					array_filter( array_map( 'sanitize_key', (array) $request->get_param( 'cpts' ) ) )
				)
			);
			if ( ! $cpts ) {
				return new WP_Error( 'no_cpts', 'Attach the taxonomy to at least one post type.', array( 'status' => 400 ) );
			}
			$label = sanitize_text_field( (string) $request->get_param( 'label' ) );
			$row   = array(
				'slug'         => $slug,
				'label'        => $label ?: $slug,
				'singular'     => sanitize_text_field( (string) ( $request->get_param( 'singular' ) ?: $label ?: $slug ) ),
				'hierarchical' => (bool) $request->get_param( 'hierarchical' ),
				'cpts'         => $cpts,
			);
			$next  = array();
			$found = false;
			foreach ( $this->content_taxonomies() as $current ) {
				if ( $slug === (string) ( $current['slug'] ?? '' ) ) {
					$next[] = $row;
					$found  = true;
				} else {
					$next[] = $current;
				}
			}
			if ( ! $found ) {
				$next[] = $row;
			}
			update_option( $this->content_option( 'taxonomies' ), $next, false );
			return new WP_REST_Response( array( 'ok' => true, 'taxonomies' => $next, 'requires_reload' => true ) );
		}

		public function save_schema_override( WP_REST_Request $request ) {
			if ( ! $this->can_configure() ) {
				return new WP_Error( 'forbidden', 'You are not allowed to manage schemas.', array( 'status' => 403 ) );
			}
			$cpt       = sanitize_key( (string) $request->get_param( 'cpt' ) );
			$overrides = $this->content_schema_overrides();
			if ( '' === $cpt ) {
				return new WP_Error( 'bad_cpt', 'A post type is required.', array( 'status' => 400 ) );
			}
			if ( 'DELETE' === $request->get_method() ) {
				unset( $overrides[ $cpt ] );
				update_option( $this->content_option( 'schema_overrides' ), $overrides, false );
				return new WP_REST_Response( array( 'ok' => true, 'schema_overrides' => $overrides ) );
			}
			$json    = (string) $request->get_param( 'json' );
			$decoded = json_decode( $json, true );
			if ( ! is_array( $decoded ) || 'object' !== ( $decoded['type'] ?? '' ) ) {
				return new WP_Error( 'bad_schema', 'Schema must be a JSON object whose root declares "type": "object".', array( 'status' => 400 ) );
			}
			$overrides[ $cpt ] = $json;
			update_option( $this->content_option( 'schema_overrides' ), $overrides, false );
			return new WP_REST_Response( array( 'ok' => true, 'schema_overrides' => $overrides ) );
		}

		public function save_agents_override( WP_REST_Request $request ) {
			if ( ! $this->can_configure() ) {
				return new WP_Error( 'forbidden', 'You are not allowed to manage agent orientation.', array( 'status' => 403 ) );
			}
			$cpt       = sanitize_key( (string) $request->get_param( 'cpt' ) );
			$overrides = $this->content_agents_overrides();
			if ( '' === $cpt ) {
				return new WP_Error( 'bad_cpt', 'A post type is required.', array( 'status' => 400 ) );
			}
			if ( 'DELETE' === $request->get_method() ) {
				unset( $overrides[ $cpt ] );
				update_option( $this->content_option( 'agents_overrides' ), $overrides, false );
				return new WP_REST_Response( array( 'ok' => true, 'agents_overrides' => $overrides ) );
			}
			$markdown = (string) $request->get_param( 'md' );
			if ( '' === trim( $markdown ) ) {
				return new WP_Error( 'empty', 'Orientation markdown cannot be empty.', array( 'status' => 400 ) );
			}
			$overrides[ $cpt ] = $markdown;
			update_option( $this->content_option( 'agents_overrides' ), $overrides, false );
			return new WP_REST_Response( array( 'ok' => true, 'agents_overrides' => $overrides ) );
		}

		public function can_edit(): bool {
			return current_user_can( $this->config['capability'] ?? 'edit_posts' );
		}

		public function can_configure(): bool {
			$capability = $this->config['manage_capability']
				?? ( 'content-types' === ( $this->config['mode'] ?? '' ) ? 'manage_options' : ( $this->config['capability'] ?? 'edit_posts' ) );
			return current_user_can( $capability );
		}

		public function save_field_group( WP_REST_Request $request ): WP_REST_Response|WP_Error {
			if ( ! $this->can_configure() ) {
				return new WP_Error( 'forbidden', 'You are not allowed to manage fields.', array( 'status' => 403 ) );
			}
			$cpt = sanitize_key( (string) $request->get_param( 'cpt' ) );
			$all = $this->field_groups();
			$all[ $cpt ] = array(
				'version' => (int) ( $all[ $cpt ]['version'] ?? 0 ) + 1,
				'fields'  => $this->sanitize_tree( (array) $request->get_param( 'fields' ) ),
				'display' => $this->sanitize_tree( (array) $request->get_param( 'display' ) ),
			);
			update_option( $this->field_option(), $all, false );
			return new WP_REST_Response( array( 'ok' => true, 'field_groups' => $all, 'requires_reload' => true ) );
		}

		public function cpt_schema( WP_REST_Request $request ): WP_REST_Response {
			$cpt    = sanitize_key( (string) $request['cpt'] );
			$groups = $this->field_groups();
			$fields = (array) ( $groups[ $cpt ]['fields'] ?? array() );
			$seen   = array();
			foreach ( $fields as $field ) {
				if ( ! empty( $field['key'] ) ) {
					$seen[ $field['key'] ] = true;
				}
			}
			foreach ( get_registered_meta_keys( 'post', $cpt ) as $key => $args ) {
				if ( isset( $seen[ $key ] ) || str_starts_with( $key, '_' ) ) {
					continue;
				}
				$fields[] = array(
					'key'   => $key,
					'label' => ucwords( str_replace( '_', ' ', $key ) ),
					'type'  => $this->descriptor_type( (string) ( $args['type'] ?? 'string' ) ),
				);
			}
			return new WP_REST_Response( array(
				'supports_editor' => post_type_supports( $cpt, 'editor' ),
				'supports_thumbnail' => post_type_supports( $cpt, 'thumbnail' ),
				'taxonomies' => $this->taxonomies_for( $cpt ), 'fields' => $fields,
				'display' => (array) ( $groups[ $cpt ]['display'] ?? array() ),
				'rest_editable' => true,
			) );
		}

		public function register_dynamic_meta(): void {
			foreach ( $this->field_groups() as $cpt => $group ) {
				foreach ( $this->flatten_fields( (array) ( $group['fields'] ?? array() ) ) as $field ) {
					$key = sanitize_key( (string) ( $field['key'] ?? '' ) );
					if ( '' === $key || in_array( $field['type'] ?? '', array( 'section', 'heading', 'tab', 'notice', 'content', 'row', 'group', 'stack' ), true ) ) {
						continue;
					}
					register_post_meta( $cpt, $key, array(
						'type' => $this->meta_type( (string) ( $field['type'] ?? 'text' ) ),
						'single' => true, 'show_in_rest' => true,
						'sanitize_callback' => array( $this, 'sanitize_meta' ),
						'auth_callback' => fn( $allowed, $meta_key, $post_id ) => current_user_can( 'edit_post', (int) $post_id ),
					) );
				}
			}
		}

		public function sanitize_meta( $value ) {
			return is_array( $value ) ? map_deep( $value, 'sanitize_text_field' ) : ( is_bool( $value ) || is_numeric( $value ) ? $value : sanitize_text_field( (string) $value ) );
		}

		private function bootstrap(): array {
			return array(
				'rest' => esc_url_raw( rest_url() ), 'nonce' => wp_create_nonce( 'wp_rest' ),
				'site_url' => esc_url_raw( home_url() ), 'assets_url' => plugin_dir_url( $this->file ) . 'assets/',
				'site_name' => html_entity_decode( get_bloginfo( 'name', 'display' ), ENT_QUOTES, 'UTF-8' ),
				'site_description' => html_entity_decode( get_bloginfo( 'description', 'display' ), ENT_QUOTES, 'UTF-8' ),
				'types' => $this->client_types(), 'initial_route' => $this->initial_route(),
				'read_token' => '', 'user' => array( 'id' => get_current_user_id(), 'display_name' => wp_get_current_user()->display_name ),
				'woocommerce' => array( 'active' => class_exists( 'WooCommerce' ) ),
				'admin_menu' => array(), 'settings_fields' => array(), 'block_editor_settings' => array(),
				'app_modules' => $this->app_modules(),
				'ai_chat' => current_user_can( 'manage_options' ) ? $this->ai_chat->client_config() : null,
			);
		}

		private function client_types(): array {
			$icons = array(
				'event' => 'calendar', 'reminder' => 'bell', 'routine' => 'rotate',
				'activity' => 'bolt', 'notification' => 'flag', 'node' => 'map',
				'content-type' => 'cube', 'wizard' => 'map', 'skill' => 'bolt',
				'wiki' => 'book', 'memory' => 'star', 'snippet' => 'scroll',
				'file' => 'folder', 'code' => 'code',
			);
			$out = array();
			foreach ( $this->config['types'] as $key => $type ) {
				$cpt = $type['post_type'] ?? '';
				$obj = $cpt ? get_post_type_object( $cpt ) : null;
				$out[ $key ] = array(
					'label' => $type['plural'], 'singular' => $type['singular'],
					'cpt' => $cpt, 'rest_base' => $obj && $obj->rest_base ? $obj->rest_base : $cpt,
					'taxonomy' => null, 'term_slug' => null, 'term_id' => 0,
					'icon' => $type['ci_icon'] ?? ( $icons[ $key ] ?? 'cube' ),
					'hierarchical' => (bool) ( $obj->hierarchical ?? false ),
					'editor' => $type['editor'] ?? match ( $key ) {
						'code' => 'code', 'wizard' => 'wizard', 'reminder' => 'reminder',
						'routine' => 'automation', default => 'cpt',
					},
					'content_editor' => $type['content_editor'] ?? ( 'snippet' === $key ? 'code' : null ),
					'kind' => 'post', 'tree' => ( $obj && $obj->hierarchical ) ? 'parent' : 'flat',
				);
			}
			if ( 'content-types' === ( $this->config['mode'] ?? '' ) ) {
				foreach ( $this->custom_content_types() as $custom ) {
					$cpt = 'os_' . $custom['slug'];
					$obj = get_post_type_object( $cpt );
					$out[ $custom['slug'] ] = array(
						'label' => $custom['plural'], 'singular' => $custom['label'],
						'cpt' => $cpt, 'rest_base' => $obj && $obj->rest_base ? $obj->rest_base : $cpt,
						'taxonomy' => null, 'term_slug' => null, 'term_id' => 0,
						'icon' => $custom['icon'] ?: 'folder', 'icon_svg' => $custom['icon_svg'],
						'hierarchical' => $custom['hierarchical'], 'editor' => $custom['editor'] ?: 'cpt',
						'editors' => $custom['editors'], 'kind' => 'post',
						'tree' => $custom['hierarchical'] ? 'parent' : 'flat',
					);
				}
			}
			return $out;
		}

		private function app_modules(): array {
			$mode = $this->config['mode'] ?? '';
			$modules = match ( $mode ) {
				'calendar', 'reminders', 'routines' => array( 'ci/app-reminders' ),
				'filesystem' => array( 'ci/app-filesystem' ),
				'code' => array( 'ci/app-code' ),
				default => array(),
			};
			foreach ( (array) ( $this->config['editor_providers'] ?? array() ) as $provider ) {
				if ( in_array( $provider, array( 'llm', 'csv', 'source' ), true ) ) {
					$modules[] = 'ci/app-' . $provider;
				}
			}
			return array_values( array_unique( $modules ) );
		}

		private function initial_route(): string {
			$page = isset( $_GET['page'] ) ? sanitize_key( wp_unslash( $_GET['page'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			$key  = $this->type_for_page( $page );
			if ( str_ends_with( $page, '-new' ) ) {
				if ( 'content-types' === ( $this->config['mode'] ?? '' ) ) {
					return '/structure/new';
				}
				if ( 'filesystem' === ( $this->config['mode'] ?? '' ) ) {
					return '/filesystem';
				}
				return '/t/' . $key . '/new';
			}
			if ( str_ends_with( $page, '-manage' ) ) {
				if ( 'content-types' === ( $this->config['mode'] ?? '' ) ) {
					return '/content-types/custom';
				}
				if ( 'filesystem' === ( $this->config['mode'] ?? '' ) ) {
					return '/filesystem';
				}
				return '/structure/' . $key . '/fields';
			}
			return match ( $this->config['mode'] ?? '' ) {
				'calendar' => 'event' === $key ? '/calendar' : '/t/' . $key, 'activity' => '/activity',
				'notifications' => '/notifications', 'graph' => '/graph',
				'filesystem' => '/filesystem', 'content-types' => '/content-types',
				default => '/t/' . $key,
			};
		}

		private function settings_payload(): array {
			$is_content       = 'content-types' === ( $this->config['mode'] ?? '' );
			$schema_overrides = $is_content ? $this->content_schema_overrides() : array();
			$agents_overrides = $is_content ? $this->content_agents_overrides() : array();
			$schemas          = array();
			foreach ( $schema_overrides as $cpt => $json ) {
				$decoded = json_decode( (string) $json, true );
				$schemas[ $cpt ] = array( 'file' => null, 'effective' => is_array( $decoded ) ? $decoded : null );
			}
			$agents_docs = array();
			foreach ( $agents_overrides as $cpt => $markdown ) {
				$agents_docs[ $cpt ] = array( 'file' => null, 'effective' => (string) $markdown );
			}
			return array(
				'custom_cpts' => $is_content ? $this->custom_content_types() : array(), 'adopted_cpts' => array(), 'cpt_candidates' => array(),
				'cpt_orphans' => array(), 'field_groups' => $this->field_groups(),
				'taxonomies' => $is_content ? $this->content_taxonomies() : array(), 'read_token' => '', 'anthropic_key_set' => false,
				'llm_provider' => class_exists( 'Core_Index_AI_Library_LLM_Provider' ) ? Core_Index_AI_Library_LLM_Provider::public_settings() : array(),
				'instance_id' => '', 'instance_id_locked' => false, 'mcp_disabled_tools' => array(),
				'mcp_all_tools' => array(), 'mcp_connector_url' => '',
				'diagnostics' => array(), 'schemas' => $schemas, 'schema_overrides' => $schema_overrides,
				'agents_docs' => $agents_docs, 'agents_overrides' => $agents_overrides,
			);
		}

		private function custom_content_types(): array {
			$out   = array();
			$seen  = array();
			$posts = get_posts(
				array(
					'post_type'      => 'os_content_type',
					'post_status'    => array( 'publish', 'private' ),
					'posts_per_page' => 100,
					'orderby'        => 'ID',
					'order'          => 'ASC',
				)
			);
			usort( $posts, static fn( $left, $right ): int => $left->ID <=> $right->ID );
			foreach ( $posts as $post ) {
				$cpt = (string) get_post_meta( $post->ID, 'content_types_type_key', true );
				$slug = preg_replace( '/^(ci|os)_/', '', sanitize_key( $cpt ) );
				$owned_dynamic_type = class_exists( 'Core_Index_Content_Types_Dynamic_Types' )
					&& is_callable( array( 'Core_Index_Content_Types_Dynamic_Types', 'owns' ) )
					&& Core_Index_Content_Types_Dynamic_Types::owns( $cpt );
				if (
					'' === $slug
					|| strlen( $cpt ) > 20
					|| $this->content_type_key_is_reserved( $cpt )
					|| ( post_type_exists( $cpt ) && ! $owned_dynamic_type )
					// Dedupe on the bare slug, not the prefixed key: mid-migration
					// the same type can exist as both `ci_x` and `os_x`, and the
					// lowest ID wins because the list is sorted by ID.
					|| isset( $seen[ $slug ] )
				) {
					continue;
				}
				$seen[ $slug ] = true;
				$config = get_post_meta( $post->ID, 'content_types_config', true );
				$config = is_array( $config ) ? $config : array();
				$out[] = array(
					'slug' => $slug,
					'label' => (string) ( get_post_meta( $post->ID, 'content_types_singular', true ) ?: $post->post_title ),
					'plural' => (string) ( get_post_meta( $post->ID, 'content_types_plural', true ) ?: $post->post_title ),
					'icon' => (string) ( $config['icon'] ?? 'folder' ), 'icon_svg' => Core_Index_Icon_SVG_Sanitizer::sanitize( (string) ( $config['icon_svg'] ?? '' ) ),
					'editor' => (string) ( $config['editor'] ?? 'cpt' ), 'editors' => (array) ( $config['editors'] ?? array( 'cpt' ) ),
					'hierarchical' => (bool) ( $config['hierarchical'] ?? false ),
					'editor_mode' => (string) ( $config['editor_mode'] ?? '' ),
					'path_template' => (string) ( $config['path_template'] ?? '' ),
				);
			}
			return $out;
		}

		private function content_option( string $kind ): string {
			return 'os_' . sanitize_key( $kind ) . '_' . str_replace( '-', '_', sanitize_key( $this->config['slug'] ) );
		}

		private function content_taxonomies(): array {
			$value = get_option( $this->content_option( 'taxonomies' ), array() );
			return is_array( $value ) ? array_values( $value ) : array();
		}

		private function content_schema_overrides(): array {
			$value = get_option( $this->content_option( 'schema_overrides' ), array() );
			return is_array( $value ) ? $value : array();
		}

		private function content_agents_overrides(): array {
			$value = get_option( $this->content_option( 'agents_overrides' ), array() );
			return is_array( $value ) ? $value : array();
		}

		private function taxonomies_for( string $cpt ): array {
			$out = array();
			foreach ( $this->content_taxonomies() as $taxonomy ) {
				$slug = sanitize_key( (string) ( $taxonomy['slug'] ?? '' ) );
				if ( '' === $slug || ! in_array( $cpt, (array) ( $taxonomy['cpts'] ?? array() ), true ) ) {
					continue;
				}
				$out[] = array(
					'slug'         => $slug,
					'label'        => (string) ( $taxonomy['label'] ?? $slug ),
					'hierarchical' => ! empty( $taxonomy['hierarchical'] ),
					'rest_base'    => $slug,
					'field'        => ( str_starts_with( $slug, 'ci_' ) || str_starts_with( $slug, 'os_' ) ? $slug : 'os_' . $slug ) . '_names',
				);
			}
			return $out;
		}

		private function field_groups(): array {
			$value = get_option( $this->field_option(), array() );
			$value = is_array( $value ) ? $value : array();
			foreach ( (array) ( $this->config['compat_field_options'] ?? array() ) as $legacy_option ) {
				if ( ! is_string( $legacy_option ) || '' === $legacy_option || $this->field_option() === $legacy_option ) {
					continue;
				}
				$legacy = get_option( $legacy_option, array() );
				if ( is_array( $legacy ) ) {
					$value = array_replace( $legacy, $value );
				}
			}
			return $value;
		}

		private function field_option(): string {
			return 'ci_field_groups_' . str_replace( '-', '_', $this->config['slug'] );
		}

		private function page_slug( string $key ): string {
			return $this->config['slug'] . '-' . sanitize_key( $key );
		}

		private function type_for_page( string $page ): string {
			foreach ( array_keys( $this->config['types'] ) as $key ) {
				if ( str_starts_with( $page, $this->page_slug( $key ) ) ) {
					return $key;
				}
			}
			return (string) array_key_first( $this->config['types'] );
		}

		private function is_page(): bool {
			$page = isset( $_GET['page'] ) ? sanitize_key( wp_unslash( $_GET['page'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			foreach ( array_keys( $this->config['types'] ) as $key ) {
				if ( str_starts_with( $page, $this->page_slug( $key ) ) ) {
					return true;
				}
			}
			return false;
		}

		private function sanitize_tree( array $value ): array {
			return map_deep( $value, static fn( $item ) => is_string( $item ) ? sanitize_text_field( $item ) : $item );
		}

		private function flatten_fields( array $fields ): array {
			$out = array();
			foreach ( $fields as $field ) {
				if ( ! is_array( $field ) ) {
					continue;
				}
				$out[] = $field;
				$out = array_merge( $out, $this->flatten_fields( (array) ( $field['fields'] ?? array() ) ) );
			}
			return $out;
		}

		private function descriptor_type( string $type ): string {
			return match ( $type ) { 'integer', 'number' => 'number', 'boolean' => 'boolean', 'object', 'array' => 'list', default => 'text' };
		}

		private function meta_type( string $type ): string {
			return match ( $type ) { 'number' => 'number', 'checkbox', 'toggle', 'boolean' => 'boolean', 'list', 'repeater', 'relationship' => 'array', default => 'string' };
		}
	}
}
