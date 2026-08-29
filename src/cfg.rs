//! The posted form *is* the config. There is no model between them: every
//! control's `name` is its dotted path, and this walks FIELDS in order turning
//! those pairs into the JSON the renderer parses.
//!
//! Nothing here removes a key. `cfg.ts` needed `clearPath` because one mutable
//! object outlived every edit; a config built fresh per request only ever has
//! to decline to add.

use crate::schema::{FIELDS, Field};
use serde_json::{Value, json};

pub type Form = Vec<(String, String)>;

pub fn parse(body: &str) -> Form {
    form_urlencoded::parse(body.as_bytes())
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect()
}

pub fn get<'a>(form: &'a Form, key: &str) -> Option<&'a str> {
    form.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str())
}

/// A field is offered only when the branch it belongs to is present -- an icon
/// motion means nothing on a ship, a rain angle means nothing with no rain.
///
/// The CSS in `assets/styles.css` mirrors this with two `:has()` rules, and the
/// two must agree: this decides what reaches the renderer, those decide what
/// the reader sees. Change one, change the other.
pub fn visible(field: &Field, form: &Form) -> bool {
    let path = field.path();
    if path.starts_with("icon.hexatri") {
        // an absent `icon` means the default branch, which is what the radio
        // renders checked -- answering "is icon.hexatri present" instead would
        // hide fields under a branch the reader can see selected
        return get(form, "icon").unwrap_or("hexatri") == "hexatri";
    }
    if path.starts_with("overlay.matrix.") {
        return get(form, "overlay.matrix").is_some();
    }
    true
}

/// Set one dotted path, creating the objects on the way and replacing only the
/// leaf. FIELDS is ordered so a branch is created before the fields inside it.
fn set(cfg: &mut Value, path: &str, value: Value) {
    let keys: Vec<&str> = path.split('.').collect();
    let (last, parents) = keys.split_last().expect("a path has at least one key");
    let mut node = cfg;
    for k in parents {
        if !node.get(*k).is_some_and(Value::is_object) {
            node[*k] = json!({});
        }
        node = node.get_mut(*k).expect("just created");
    }
    node[*last] = value;
}

pub fn build(form: &Form) -> Value {
    let mut cfg = json!({});
    for field in FIELDS {
        if !visible(field, form) {
            continue;
        }
        match field {
            // An emptied number input posts "". Storing it would serialise as
            // null, which the renderer rejects; absent is what "no value" means.
            Field::Number { path, .. } => {
                if let Some(n) = get(form, path).and_then(|v| v.parse::<u64>().ok()) {
                    set(&mut cfg, path, json!(n));
                }
            }
            Field::Enum { path, .. } => {
                if let Some(v) = get(form, path) {
                    set(&mut cfg, path, json!(v));
                }
            }
            // a oneof: only the chosen branch is ever created
            Field::Choice { path, def, .. } => {
                let branch = get(form, path).unwrap_or(def);
                set(&mut cfg, &format!("{path}.{branch}"), json!({}));
            }
            // an unchecked checkbox is not posted at all -- HTML's own semantics
            Field::Toggle { path, .. } => {
                if get(form, path).is_some() {
                    set(&mut cfg, path, json!({}));
                }
            }
            // The picker gives #rrggbb and cannot express alpha. form.ts kept
            // whatever alpha the config carried, because a pasted JSON could
            // set one; with no JSON pane the schema default is the only alpha
            // there is.
            // ponytail: schema alpha only, revisit if a config ever arrives by
            // another route than these controls.
            Field::Color { path, def, .. } => {
                if let Some(v) = get(form, path) {
                    let alpha = if def.len() == 9 { &def[7..] } else { "" };
                    set(&mut cfg, path, json!(format!("{v}{alpha}")));
                }
            }
        }
    }
    cfg
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn form(pairs: &[(&str, &str)]) -> Form {
        pairs.iter().map(|(k, v)| ((*k).to_string(), (*v).to_string())).collect()
    }

    /// What the browser posts once every control has been rendered and none
    /// touched. It is not the minimal `{}` the TypeScript built, but the
    /// renderer produces byte-identical output for both -- every value here is
    /// a proto3 zero.
    fn defaults() -> Form {
        form(&[
            ("seed", "0"),
            ("background.motion", "STATIC"),
            ("background.image", "NONE"),
            ("icon", "hexatri"),
            ("icon.hexatri.motion", "ROTATE"),
            ("overlay.matrix.angle", "0"),
            ("overlay.matrix.color", "#395e53"),
            ("res", "1080p"),
            ("res-custom", ""),
        ])
    }

    #[test]
    fn parses_a_urlencoded_body() {
        let f = parse("seed=7&background.motion=SCAN&res-custom=800x600");
        assert_eq!(get(&f, "seed"), Some("7"));
        assert_eq!(get(&f, "background.motion"), Some("SCAN"));
        assert_eq!(get(&f, "res-custom"), Some("800x600"));
        assert_eq!(get(&f, "nothing"), None);
    }

    #[test]
    fn an_untouched_form_is_the_default_config() {
        assert_eq!(
            build(&defaults()),
            json!({
                "seed": 0,
                "background": { "motion": "STATIC", "image": "NONE" },
                "icon": { "hexatri": { "motion": "ROTATE" } }
            })
        );
    }

    #[test]
    fn an_empty_number_omits_its_key() {
        let mut f = defaults();
        f.retain(|(k, _)| k != "seed");
        f.push(("seed".into(), "".into()));
        assert!(build(&f).get("seed").is_none(), "an emptied field means absent, not null");
    }

    #[test]
    fn an_unchecked_toggle_omits_the_whole_subtree() {
        // the browser does not post an unchecked checkbox at all
        assert!(build(&defaults()).get("overlay").is_none());
    }

    #[test]
    fn a_checked_toggle_brings_its_branch_and_its_fields() {
        let mut f = defaults();
        f.push(("overlay.matrix".into(), "on".into()));
        assert_eq!(
            build(&f)["overlay"]["matrix"],
            json!({ "angle": 0, "color": "#395e53b3" })
        );
    }

    #[test]
    fn the_colour_picker_keeps_the_schema_alpha() {
        let mut f = defaults();
        f.push(("overlay.matrix".into(), "on".into()));
        f.retain(|(k, _)| k != "overlay.matrix.color");
        f.push(("overlay.matrix.color".into(), "#ff0000".into()));
        assert_eq!(build(&f)["overlay"]["matrix"]["color"], json!("#ff0000b3"));
    }

    #[test]
    fn choosing_ship_replaces_the_hexatri_branch_and_drops_its_fields() {
        let mut f = defaults();
        f.retain(|(k, _)| k != "icon");
        f.push(("icon".into(), "ship".into()));
        let cfg = build(&f);
        assert_eq!(cfg["icon"], json!({ "ship": {} }));
        assert!(cfg["icon"].get("hexatri").is_none());
    }

    #[test]
    fn visible_hides_hexatri_fields_when_ship_is_chosen() {
        let motion = FIELDS.iter().find(|f| f.path() == "icon.hexatri.motion").unwrap();
        assert!(visible(motion, &defaults()));
        assert!(!visible(motion, &form(&[("icon", "ship")])));
        // an absent `icon` means the default branch, which is hexatri -- the
        // control shows checked, so the field it governs must show too
        assert!(visible(motion, &form(&[])));
    }

    #[test]
    fn visible_hides_rain_fields_when_the_toggle_is_off() {
        let angle = FIELDS.iter().find(|f| f.path() == "overlay.matrix.angle").unwrap();
        let toggle = FIELDS.iter().find(|f| f.path() == "overlay.matrix").unwrap();
        assert!(!visible(angle, &form(&[])));
        assert!(visible(angle, &form(&[("overlay.matrix", "on")])));
        // the toggle itself is never hidden by its own state
        assert!(visible(toggle, &form(&[])));
    }

    /// Everything build() produces must be something the renderer accepts, or
    /// the mapping is wrong in a way no assertion above would catch.
    #[test]
    fn every_config_build_produces_renders() {
        for extra in [vec![], vec![("overlay.matrix", "on")], vec![("icon", "ship")]] {
            let mut f = defaults();
            for (k, v) in &extra {
                f.retain(|(key, _)| key != k);
                f.push(((*k).to_string(), (*v).to_string()));
            }
            let cfg = build(&f).to_string();
            bgsvg::render_to_string(&cfg, 320, 180)
                .unwrap_or_else(|e| panic!("{cfg} was rejected: {e}"));
        }
    }
}
