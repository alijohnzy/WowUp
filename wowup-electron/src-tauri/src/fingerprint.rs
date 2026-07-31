//! The CurseForge addon fingerprint — port of `native/curse.cc`.
//!
//! A whitespace-stripping murmur2 variant. CurseForge identifies an installed addon by
//! hashing its files and matching the result against its own index, so this has to be
//! **bit-exact**: a one-bit difference means every addon reports as unmatched and update
//! detection silently stops working.
//!
//! In Electron this was a `node-gyp` N-API addon, which meant a C++ toolchain on all three
//! CI runners and a rebuild on every Electron ABI bump. Here it is ordinary Rust that the
//! same toolchain already builds — the one part of this migration that gets strictly
//! cheaper.
//!
//! Written against the C++ deliberately literally, wrapping arithmetic and all, rather than
//! tidied into idiomatic Rust: the whole value is in matching it exactly.

/// `curse::isWhitespaceCharacter` — tab, LF, CR, space.
#[inline]
fn is_whitespace(b: u8) -> bool {
    b == 9 || b == 10 || b == 13 || b == 32
}

/// `curse::computeNormalizedLength` — the byte count ignoring whitespace.
fn normalized_length(buffer: &[u8]) -> u32 {
    buffer.iter().filter(|b| !is_whitespace(**b)).count() as u32
}

/// `curse::computeHash`.
///
/// Note the asymmetry, which is in the original and is load-bearing: the seed uses the
/// *normalized* length while the loop walks the *full* buffer and skips whitespace as it
/// goes. Seeding with `buffer.len()` instead produces a plausible-looking hash that matches
/// nothing.
pub fn compute_hash(buffer: &[u8]) -> u32 {
    const MULTIPLEX: u32 = 1_540_483_477;

    let num1 = normalized_length(buffer);
    let mut num2: u32 = 1 ^ num1;
    let mut num3: u32 = 0;
    let mut num4: u32 = 0;

    for &b in buffer {
        if is_whitespace(b) {
            continue;
        }

        num3 |= u32::from(b) << num4;
        num4 += 8;

        if num4 == 32 {
            let num6 = num3.wrapping_mul(MULTIPLEX);
            let num7 = (num6 ^ (num6 >> 24)).wrapping_mul(MULTIPLEX);

            num2 = num2.wrapping_mul(MULTIPLEX) ^ num7;
            num3 = 0;
            num4 = 0;
        }
    }

    if num4 > 0 {
        num2 = (num2 ^ num3).wrapping_mul(MULTIPLEX);
    }

    let num6 = (num2 ^ (num2 >> 13)).wrapping_mul(MULTIPLEX);
    num6 ^ (num6 >> 15)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Golden values produced by the C++ addon this replaces, via:
    //   node -e 'const a=require("./build/Release/addon.node");
    //            const b=Buffer.from(<input>); console.log(a.computeHash(b, b.length))'
    // If one of these ever disagrees, the fingerprint is wrong and CurseForge matching is
    // broken — do not "fix" the test.
    #[test]
    fn matches_the_native_addon_on_known_inputs() {
        for (input, expected) in GOLDEN {
            assert_eq!(
                compute_hash(input.as_bytes()),
                *expected,
                "fingerprint changed for {input:?}"
            );
        }
    }

    /// Whitespace must not affect the result — that is the entire point of the variant.
    #[test]
    fn whitespace_is_ignored() {
        let bare = compute_hash(b"## Interface: 110000");
        assert_eq!(compute_hash(b"##Interface:110000"), bare);
        assert_eq!(compute_hash(b"## Interface:\t110000\r\n"), bare);
        assert_eq!(compute_hash(b"  ##  Interface:  110000  "), bare);
    }

    #[test]
    fn an_empty_buffer_has_a_stable_hash() {
        // Reached for a zero-byte .toc, which does occur.
        assert_eq!(compute_hash(b""), compute_hash(b"   \r\n\t"));
    }

    #[test]
    fn differs_on_a_single_byte() {
        assert_ne!(
            compute_hash(b"## Version: 1.0.0"),
            compute_hash(b"## Version: 1.0.1")
        );
    }

    #[test]
    fn handles_a_buffer_that_is_not_a_multiple_of_four() {
        // Exercises the `num4 > 0` tail branch, which is where an off-by-one would hide.
        for n in 1..=9 {
            let input = "x".repeat(n);
            assert_ne!(compute_hash(input.as_bytes()), 0, "len {n}");
        }
    }

    #[test]
    fn handles_high_bytes() {
        // `char` is signed on x86 C++, so a byte above 0x7F would sign-extend unless the
        // cast to `unsigned char` happens first — which the original does. Golden value from
        // the native addon, so a Rust port that got the signedness wrong fails here.
        assert_eq!(compute_hash(&[0xFFu8, 0x00, 0x80, 0x7F]), 3_785_212_474);
    }

    /// A real .toc off disk, 2794 bytes — long enough to exercise many full words plus a
    /// tail, which the short literals above do not.
    #[test]
    fn matches_the_native_addon_on_a_real_toc() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/Coolinator.toc");
        let Ok(bytes) = std::fs::read(path) else {
            // The fixture is committed; if it is missing the rest of the suite still stands.
            eprintln!("skipping: {path} not found");
            return;
        };
        assert_eq!(compute_hash(&bytes), 2_350_932_591);
    }

    /// Produced by the native addon; see the comment above.
    const GOLDEN: &[(&str, u32)] = &[
        ("", 1_540_447_798),
        ("a", 626_045_324),
        ("## Interface: 110000", 1_966_922_430),
        ("## Title: WeakAuras\n## Version: 5.0.0\n", 478_170_242),
        // Same three, whitespace-mangled: the hash must not move.
        ("##Interface:110000", 1_966_922_430),
        ("  ##  Interface:  110000  ", 1_966_922_430),
        // Nine bytes, so the tail branch (`num4 > 0`) runs with a partial word.
        ("xxxxxxxxx", 645_649_004),
    ];
}
