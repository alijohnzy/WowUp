//! Decoder for Blizzard's `product.db`.
//!
//! Port of `src/common/wowup/product-db.ts`, which declares the schema with protobufjs
//! decorators rather than a `.proto` file:
//!
//! ```text
//! Client   { 1: string location,  13: string name }
//! Product  { 1: string name, 2: string alias, 3: Client client, 6: string family }
//! ProductDb{ 1: repeated Product products }
//! ```
//!
//! Hand-rolled rather than `prost`, because `prost-build` wants a `protoc` binary on every
//! dev machine and CI runner. Three messages and four interesting field numbers do not
//! justify that; the wire format below is the whole of what protobuf needs here.
//!
//! Unknown fields are skipped rather than rejected — Blizzard adds fields to this file and
//! the JS decoder tolerates them, so this must too.

/// A cursor over protobuf-encoded bytes.
struct Reader<'a> {
    buf: &'a [u8],
    pos: usize,
}

#[derive(Debug, PartialEq)]
pub enum DecodeError {
    UnexpectedEof,
    VarintOverflow,
    UnsupportedWireType(u8),
}

impl std::fmt::Display for DecodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnexpectedEof => write!(f, "unexpected end of buffer"),
            Self::VarintOverflow => write!(f, "varint exceeds 64 bits"),
            Self::UnsupportedWireType(w) => write!(f, "unsupported wire type {w}"),
        }
    }
}

type Result<T> = std::result::Result<T, DecodeError>;

impl<'a> Reader<'a> {
    fn new(buf: &'a [u8]) -> Self {
        Self { buf, pos: 0 }
    }

    fn done(&self) -> bool {
        self.pos >= self.buf.len()
    }

    fn byte(&mut self) -> Result<u8> {
        let b = *self.buf.get(self.pos).ok_or(DecodeError::UnexpectedEof)?;
        self.pos += 1;
        Ok(b)
    }

    fn varint(&mut self) -> Result<u64> {
        let mut value: u64 = 0;
        for shift in (0..64).step_by(7) {
            let b = self.byte()?;
            value |= u64::from(b & 0x7F) << shift;
            if b & 0x80 == 0 {
                return Ok(value);
            }
        }
        Err(DecodeError::VarintOverflow)
    }

    fn bytes(&mut self) -> Result<&'a [u8]> {
        let len = self.varint()? as usize;
        let end = self
            .pos
            .checked_add(len)
            .filter(|e| *e <= self.buf.len())
            .ok_or(DecodeError::UnexpectedEof)?;
        let slice = &self.buf[self.pos..end];
        self.pos = end;
        Ok(slice)
    }

    /// Protobuf strings are UTF-8, but a corrupt `product.db` should degrade to an empty
    /// path rather than fail the whole decode — matching protobufjs, which is lenient here.
    fn string(&mut self) -> Result<String> {
        Ok(String::from_utf8_lossy(self.bytes()?).into_owned())
    }

    /// Reads a tag and returns `(field_number, wire_type)`.
    fn tag(&mut self) -> Result<(u64, u8)> {
        let tag = self.varint()?;
        Ok((tag >> 3, (tag & 0x07) as u8))
    }

    fn skip(&mut self, wire_type: u8) -> Result<()> {
        match wire_type {
            0 => {
                self.varint()?;
            }
            1 => self.advance(8)?,
            2 => {
                self.bytes()?;
            }
            5 => self.advance(4)?,
            other => return Err(DecodeError::UnsupportedWireType(other)),
        }
        Ok(())
    }

    fn advance(&mut self, n: usize) -> Result<()> {
        let end = self
            .pos
            .checked_add(n)
            .filter(|e| *e <= self.buf.len())
            .ok_or(DecodeError::UnexpectedEof)?;
        self.pos = end;
        Ok(())
    }
}

#[derive(Debug, Default, Clone, PartialEq)]
pub struct Client {
    pub location: String,
    pub name: String,
}

#[derive(Debug, Default, Clone, PartialEq)]
pub struct Product {
    pub name: String,
    pub alias: String,
    pub client: Client,
    pub family: String,
}

#[derive(Debug, Default, Clone, PartialEq)]
pub struct ProductDb {
    pub products: Vec<Product>,
}

impl Client {
    fn decode(buf: &[u8]) -> Result<Self> {
        let mut r = Reader::new(buf);
        let mut out = Self::default();
        while !r.done() {
            match r.tag()? {
                (1, 2) => out.location = r.string()?,
                (13, 2) => out.name = r.string()?,
                (_, w) => r.skip(w)?,
            }
        }
        Ok(out)
    }
}

impl Product {
    fn decode(buf: &[u8]) -> Result<Self> {
        let mut r = Reader::new(buf);
        let mut out = Self::default();
        while !r.done() {
            match r.tag()? {
                (1, 2) => out.name = r.string()?,
                (2, 2) => out.alias = r.string()?,
                (3, 2) => out.client = Client::decode(r.bytes()?)?,
                (6, 2) => out.family = r.string()?,
                (_, w) => r.skip(w)?,
            }
        }
        Ok(out)
    }
}

impl ProductDb {
    pub fn decode(buf: &[u8]) -> Result<Self> {
        let mut r = Reader::new(buf);
        let mut out = Self::default();
        while !r.done() {
            match r.tag()? {
                (1, 2) => out.products.push(Product::decode(r.bytes()?)?),
                (_, w) => r.skip(w)?,
            }
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Minimal protobuf encoder, test-only — it exists so the tests below state their
    /// fixtures as structure rather than as hex blobs nobody can review.
    fn varint(mut v: u64, out: &mut Vec<u8>) {
        loop {
            let b = (v & 0x7F) as u8;
            v >>= 7;
            if v == 0 {
                out.push(b);
                return;
            }
            out.push(b | 0x80);
        }
    }

    fn field(num: u64, wire: u8, out: &mut Vec<u8>) {
        varint((num << 3) | u64::from(wire), out);
    }

    fn string_field(num: u64, s: &str, out: &mut Vec<u8>) {
        field(num, 2, out);
        varint(s.len() as u64, out);
        out.extend_from_slice(s.as_bytes());
    }

    fn message_field(num: u64, body: &[u8], out: &mut Vec<u8>) {
        field(num, 2, out);
        varint(body.len() as u64, out);
        out.extend_from_slice(body);
    }

    fn client(location: &str, name: &str) -> Vec<u8> {
        let mut b = Vec::new();
        string_field(1, location, &mut b);
        string_field(13, name, &mut b);
        b
    }

    fn product(name: &str, family: &str, client_body: &[u8]) -> Vec<u8> {
        let mut b = Vec::new();
        string_field(1, name, &mut b);
        string_field(2, "alias", &mut b);
        message_field(3, client_body, &mut b);
        string_field(6, family, &mut b);
        b
    }

    #[test]
    fn decodes_a_single_wow_product() {
        let mut db = Vec::new();
        message_field(
            1,
            &product("wow", "wow", &client("C:\\World of Warcraft", "_retail_")),
            &mut db,
        );

        let decoded = ProductDb::decode(&db).unwrap();
        assert_eq!(decoded.products.len(), 1);
        assert_eq!(decoded.products[0].family, "wow");
        assert_eq!(decoded.products[0].client.name, "_retail_");
        assert_eq!(decoded.products[0].client.location, "C:\\World of Warcraft");
    }

    #[test]
    fn decodes_multiple_products_preserving_order() {
        let mut db = Vec::new();
        message_field(
            1,
            &product("wow", "wow", &client("/a", "_retail_")),
            &mut db,
        );
        message_field(
            1,
            &product("wow_classic", "wow", &client("/b", "_classic_")),
            &mut db,
        );
        message_field(1, &product("agent", "agent", &client("/c", "")), &mut db);

        let decoded = ProductDb::decode(&db).unwrap();
        assert_eq!(decoded.products.len(), 3);
        assert_eq!(decoded.products[1].client.name, "_classic_");
        assert_eq!(decoded.products[2].family, "agent");
    }

    /// Blizzard adds fields to this file. protobufjs ignores what it does not know, and a
    /// decoder that threw here would break WoW detection on the next Battle.net update.
    #[test]
    fn skips_unknown_fields_of_every_wire_type() {
        let mut inner = client("/loc", "_retail_");
        field(7, 0, &mut inner); // unknown varint
        varint(300, &mut inner);
        field(8, 5, &mut inner); // unknown fixed32
        inner.extend_from_slice(&[1, 2, 3, 4]);
        field(9, 1, &mut inner); // unknown fixed64
        inner.extend_from_slice(&[1, 2, 3, 4, 5, 6, 7, 8]);
        string_field(10, "ignored", &mut inner); // unknown length-delimited

        let mut db = Vec::new();
        message_field(1, &product("wow", "wow", &inner), &mut db);

        let decoded = ProductDb::decode(&db).unwrap();
        assert_eq!(decoded.products[0].client.name, "_retail_");
        assert_eq!(decoded.products[0].client.location, "/loc");
    }

    #[test]
    fn empty_buffer_decodes_to_no_products() {
        assert_eq!(ProductDb::decode(&[]).unwrap().products.len(), 0);
    }

    #[test]
    fn truncated_length_delimited_field_is_an_error() {
        // Field 1, wire type 2, claims 50 bytes but supplies 2.
        let buf = [0x0A, 50, 1, 2];
        assert_eq!(ProductDb::decode(&buf), Err(DecodeError::UnexpectedEof));
    }

    #[test]
    fn unterminated_varint_is_an_error() {
        // Ten continuation bytes overflows the 64-bit varint budget.
        let buf = [0xFF; 10];
        assert_eq!(ProductDb::decode(&buf), Err(DecodeError::VarintOverflow));
    }

    #[test]
    fn multibyte_lengths_round_trip() {
        // Forces a two-byte varint length prefix, exercising the shift loop.
        let long = "x".repeat(200);
        let mut db = Vec::new();
        message_field(
            1,
            &product("wow", "wow", &client(&long, "_retail_")),
            &mut db,
        );

        let decoded = ProductDb::decode(&db).unwrap();
        assert_eq!(decoded.products[0].client.location.len(), 200);
    }
}
