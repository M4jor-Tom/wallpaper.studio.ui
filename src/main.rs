//! The editor as a server. Routing is a pure function of the request, so every
//! route is testable without a socket -- and the sandbox this was written in
//! forbids loopback connections, so that is the only kind of test there is.

mod cfg;
mod page;
mod schema;

use askama::Template;
use cfg::Form;
use page::{Page, Preview, controls};
use tiny_http::{Header, Method, Request, Response, Server};

const STYLES: &str = include_str!("../assets/styles.css");
const HTMX: &str = include_str!("../assets/htmx.min.js");

pub struct Reply {
    pub status: u16,
    pub headers: Vec<(&'static str, String)>,
    pub body: String,
}

impl Reply {
    fn new(status: u16, content_type: &str, body: String) -> Self {
        Reply {
            status,
            headers: vec![
                ("Content-Type", content_type.to_string()),
                // A live server can say this from the first response, so the
                // entry the ?<store-name> query key used to defeat is never
                // created. See tasks/lessons.md.
                ("Cache-Control", "no-store".to_string()),
            ],
            body,
        }
    }

    fn html(body: String) -> Self {
        Reply::new(200, "text/html; charset=utf-8", body)
    }

    fn with(mut self, key: &'static str, value: &str) -> Self {
        self.headers.push((key, value.to_string()));
        self
    }
}

fn theme_of(cookie: Option<&str>) -> &'static str {
    let has = |want: &str| {
        cookie.is_some_and(|c| c.split(';').any(|p| p.trim() == want))
    };
    if has("theme=dark") {
        "dark"
    } else if has("theme=light") {
        "light"
    } else {
        // no cookie: the palette follows prefers-color-scheme, in CSS, because
        // nothing here can see it
        ""
    }
}

/// Resolution parsing is the module's, never re-derived here -- including its
/// edge cases: empty means 1080p, zero is rejected.
///
/// The emptiness check is strict rather than `.trim()`: collapsing whitespace
/// would fall back to the preset instead of letting parse_res reject it.
fn resolve(form: &Form) -> Result<(u32, u32), String> {
    let custom = cfg::get(form, "res-custom").unwrap_or("");
    let preset = cfg::get(form, "res").unwrap_or(bgsvg::params::RESOLUTIONS[0].0);
    let spec = if custom.is_empty() { preset } else { custom };
    bgsvg::params::parse_res(spec).map_err(|e| e.to_string())
}

fn render(form: &Form) -> Result<String, String> {
    let (w, h) = resolve(form)?;
    bgsvg::render_to_string(&cfg::build(form).to_string(), w, h).map_err(|e| e.to_string())
}

/// The page, from a form that may not exist yet. `error` is "" when there is
/// nothing to say, which is what hides the banner.
fn page(form: Option<&Form>, theme: &'static str, error: String) -> Reply {
    let owned = Form::new();
    let f = form.unwrap_or(&owned);
    let (svg, error) = match render(f) {
        Ok(svg) => (svg, error),
        // the page cannot be blank, so an unrenderable config still gets a
        // document -- with the reason in the banner
        Err(e) => (String::new(), if error.is_empty() { e } else { error }),
    };
    let html = Page {
        theme,
        controls: controls(form),
        resolutions: &bgsvg::params::RESOLUTIONS,
        res: cfg::get(f, "res").unwrap_or(bgsvg::params::RESOLUTIONS[0].0).to_string(),
        res_custom: cfg::get(f, "res-custom").unwrap_or("").to_string(),
        error,
        svg,
    }
    .render()
    .expect("the page template renders");
    Reply::html(html)
}

/// A keystroke. The response is the render for #stage plus the banner out of
/// band, so the form keeps its focus and its caret.
fn preview(form: &Form) -> Reply {
    match render(form) {
        Ok(svg) => Reply::html(
            Preview { svg, error: String::new() }
                .render()
                .expect("the preview template renders"),
        ),
        // The preview never blanks: it holds the last valid render, so a config
        // in a half-finished state does not destroy what you were looking at.
        // Without HX-Reswap the empty body would be swapped in and #stage would
        // go blank; the out-of-band banner is applied either way.
        Err(e) => Reply::html(
            Preview { svg: String::new(), error: e }
                .render()
                .expect("the preview template renders"),
        )
        .with("HX-Reswap", "none"),
    }
}

pub fn route(method: &Method, url: &str, body: &str, cookie: Option<&str>) -> Reply {
    match (method, url) {
        (Method::Get, "/") => page(None, theme_of(cookie), String::new()),
        (Method::Get, "/styles.css") => {
            Reply::new(200, "text/css; charset=utf-8", STYLES.to_string())
        }
        (Method::Get, "/htmx.min.js") => {
            Reply::new(200, "text/javascript; charset=utf-8", HTMX.to_string())
        }
        (Method::Post, "/preview") => preview(&cfg::parse(body)),
        _ => Reply::new(404, "text/plain; charset=utf-8", "not found".to_string()),
    }
}

fn main() {
    let port = std::env::args()
        .skip_while(|a| a != "--port")
        .nth(1)
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(5173);
    let server = Server::http(("127.0.0.1", port))
        .unwrap_or_else(|e| panic!("wallpaper-studio-ui: cannot listen on 127.0.0.1:{port}: {e}"));
    eprintln!("wallpaper-studio-ui: http://127.0.0.1:{port}/");
    // ponytail: one request at a time. A second window would wait its turn;
    // the upgrade is tiny_http's own thread pool.
    for request in server.incoming_requests() {
        serve(request);
    }
}

fn serve(mut request: Request) {
    let mut body = String::new();
    request.as_reader().read_to_string(&mut body).ok();
    let cookie = request
        .headers()
        .iter()
        .find(|h| h.field.equiv("Cookie"))
        .map(|h| h.value.as_str().to_owned());
    let reply = route(request.method(), request.url(), &body, cookie.as_deref());
    let mut response = Response::from_string(reply.body).with_status_code(reply.status);
    for (k, v) in reply.headers {
        // add_header overwrites Content-Type rather than duplicating it, so
        // from_string's text/plain default is replaced, not appended to
        if let Ok(h) = Header::from_bytes(k.as_bytes(), v.as_bytes()) {
            response.add_header(h);
        }
    }
    request.respond(response).ok();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn get(url: &str) -> Reply {
        route(&Method::Get, url, "", None)
    }

    #[test]
    fn the_renderer_is_linked() {
        let svg = bgsvg::render_to_string("{}", 640, 360).expect("the empty config renders");
        assert!(svg.starts_with("<svg"), "expected an SVG document, got {:.40}", svg);
    }

    #[test]
    fn the_index_arrives_already_rendered() {
        let r = get("/");
        assert_eq!(r.status, 200);
        assert!(r.body.contains("<svg"), "the first paint carries a render");
        assert!(r.body.contains("id=\"cfg\""));
        assert!(r.headers.iter().any(|(k, v)| *k == "Content-Type" && v.starts_with("text/html")));
    }

    #[test]
    fn every_response_refuses_to_be_cached() {
        for url in ["/", "/styles.css", "/htmx.min.js", "/nope"] {
            let r = get(url);
            assert!(
                r.headers.iter().any(|(k, v)| *k == "Cache-Control" && v == "no-store"),
                "{url} may be cached"
            );
        }
    }

    #[test]
    fn the_assets_are_served_from_the_binary() {
        let css = get("/styles.css");
        assert_eq!(css.status, 200);
        assert!(css.body.contains("#dock"));
        assert!(css.headers.iter().any(|(k, v)| *k == "Content-Type" && v.starts_with("text/css")));

        let js = get("/htmx.min.js");
        assert_eq!(js.status, 200);
        assert!(js.body.contains("htmx"));
    }

    #[test]
    fn an_unknown_path_is_a_404() {
        assert_eq!(get("/nope").status, 404);
        assert_eq!(route(&Method::Post, "/", "", None).status, 404);
    }

    #[test]
    fn the_cookie_decides_the_theme_and_nothing_else_does() {
        assert_eq!(theme_of(None), "");
        assert_eq!(theme_of(Some("theme=dark")), "dark");
        assert_eq!(theme_of(Some("other=1; theme=light")), "light");
        assert_eq!(theme_of(Some("theme=purple")), "");
        assert!(get("/").body.contains("<html lang=\"en\">"), "no cookie means no attribute");
        assert!(
            route(&Method::Get, "/", "", Some("theme=dark")).body.contains("data-theme=\"dark\""),
        );
    }

    #[test]
    fn the_resolution_comes_from_the_module_not_from_here() {
        // an empty custom field falls back to the preset; the module decides
        // what each spelling means, including that "" is 1080p
        assert_eq!(resolve(&cfg::parse("res=1440p&res-custom=")), Ok((2560, 1440)));
        assert_eq!(resolve(&cfg::parse("res=1080p&res-custom=800x600")), Ok((800, 600)));
        assert!(resolve(&cfg::parse("res=1080p&res-custom=nonsense")).is_err());
    }

    fn post(url: &str, body: &str) -> Reply {
        route(&Method::Post, url, body, None)
    }

    /// What the browser posts with every control at its default.
    const DEFAULTS: &str = "seed=0&background.motion=STATIC&background.image=NONE\
&icon=hexatri&icon.hexatri.motion=ROTATE&overlay.matrix.angle=0\
&overlay.matrix.color=%23395e53&res=1080p&res-custom=";

    #[test]
    fn a_preview_is_an_svg_and_a_silent_banner() {
        let r = post("/preview", DEFAULTS);
        assert_eq!(r.status, 200);
        assert!(r.body.contains("<svg"));
        assert!(r.body.contains("id=\"error\" role=\"alert\" hx-swap-oob=\"true\" hidden"));
        assert!(!r.headers.iter().any(|(k, _)| *k == "HX-Reswap"));
    }

    #[test]
    fn a_rejected_config_keeps_the_last_render_on_screen() {
        // CLOSEOPEN with image NONE is reachable from the controls, and the
        // renderer rejects it
        let body = DEFAULTS.replace("motion=STATIC", "motion=CLOSEOPEN");
        let r = post("/preview", &body);
        assert_eq!(r.status, 200);
        assert!(
            r.headers.iter().any(|(k, v)| *k == "HX-Reswap" && v == "none"),
            "without this htmx swaps the empty body in and #stage goes blank"
        );
        assert!(!r.body.contains("<svg"), "nothing may replace the render");
        assert!(r.body.contains("CLOSEOPEN"), "the renderer's own words: {}", r.body);
        assert!(!r.body.contains(" hidden"), "the banner has to be visible");
    }

    #[test]
    fn a_bad_resolution_reaches_the_same_banner() {
        let body = DEFAULTS.replace("res-custom=", "res-custom=1920x0");
        let r = post("/preview", &body);
        assert!(r.headers.iter().any(|(k, v)| *k == "HX-Reswap" && v == "none"));
        assert!(!r.body.contains(" hidden"));
    }

    #[test]
    fn the_preview_follows_the_selected_output_ratio() {
        let tall = post("/preview", &DEFAULTS.replace("res-custom=", "res-custom=1080x1920"));
        assert!(tall.body.contains("width=\"1080\""), "{:.200}", tall.body);
        assert!(tall.body.contains("height=\"1920\""), "{:.200}", tall.body);
    }
}
